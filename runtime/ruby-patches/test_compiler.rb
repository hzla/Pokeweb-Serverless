# frozen_string_literal: true
require 'minitest/autorun'
require_relative 'compiler'

class RubyPatchCompilerTest < Minitest::Test
  PROFILE = { 'entry' => 'test', 'games' => { 'W2' => { 'overlay' => 284, 'hooks' => ['0x021e359c'] } } }.freeze

  def compile(body, declaration: 'signature :test, args: { value: :u32 }, returns: :u32', params: 'value', extra: '')
    source = "#{extra}\n#{declaration}\ndef test(#{params})\n#{body}\nend\n"
    RubyPatch::Compiler.new(source, PROFILE, 'W2').compile
  end

  def rejects(body, message, **options)
    error = assert_raises(RubyPatch::Error) { compile(body, **options) }
    assert_includes error.message, message
  end

  def test_integer_arithmetic_and_explicit_returns
    text = compile("if value >= 50\nreturn 0\nelse\nreturn value + 1\nend")
    assert_includes text, 'THUMB_BRANCH_LINK_284_0x21E359C'
    assert_includes text, 'uint32_t'
  end

  def test_no_build_time_execution
    source = "system('this-must-never-execute')\n"
    error = assert_raises(RubyPatch::Error) { RubyPatch::Compiler.new(source, PROFILE, 'W2').compile }
    assert_includes error.message, 'top level accepts only'
  end

  def test_rejects_dynamic_ruby
    rejects('return value.to_s', 'unsupported expression')
    rejects('return [value]', 'unsupported expression')
    rejects('return -1', 'only boolean !')
    rejects('return 4294967296', 'must fit u32')
  end

  def test_rejects_integer_truthiness
    rejects("if value\nreturn 1\nelse\nreturn 0\nend", 'conditions require booleans')
    rejects('return value && 1', 'logical operators require two booleans')
  end

  def test_rejects_uninitialized_branch_and_loop_locals
    rejects("if value == 0\nx = 1\nend\nreturn x", 'uninitialized local x')
    rejects("while value > 0\nx = 1\nvalue -= 1\nend\nreturn x", 'uninitialized local x')
  end

  def test_all_path_returns_and_else_assignment
    compile("if value == 0\nx = 1\nelse\nx = 2\nend\nreturn x")
    rejects("if value == 0\nreturn 0\nend", 'explicit return on every path')
    rejects("return 0\nvalue = 1", 'unreachable statement')
    rejects('value', 'unsupported statement')
  end

  def test_native_call_contracts_and_evaluation_order
    native = 'native :read_value, symbol: "ReadValue", args: [:u32], returns: :u32'
    compile("result = read_value(value)\nreturn result", extra: native)
    rejects('return read_value()', 'wrong argument count', extra: native)
    rejects('return unknown(value)', 'undeclared function')
    rejects('return read_value(value) + read_value(value)', 'nested calls', extra: native)
    rejects('return read_value(read_value(value))', 'nested calls', extra: native)
    rejects('return read_value(value)', 'wrong type', extra: native,
            declaration: 'signature :test, args: { value: :ptr }, returns: :u32')
  end

  def test_rejects_narrowing_and_parameter_changes
    rejects('value = 256', 'narrows an integer', declaration: 'signature :test, args: { value: :u8 }, returns: :void')
    rejects('return value', 'narrowing', declaration: 'signature :test, args: { value: :u32 }, returns: :u16')
    rejects('return 0', 'parameter names/order', params: 'different')
  end

  def test_real_patch_compiles_for_both_games
    source = File.read(File.join(__dir__, 'form_evolution.rb'))
    profile = JSON.parse(File.read(File.join(__dir__, 'form_evolution.json')))
    %w[B2 W2].each do |game|
      output = RubyPatch::Compiler.new(source, profile, game).compile
      assert_equal 2, output.scan(/^void THUMB_BRANCH_LINK_/).length
    end
  end
end
