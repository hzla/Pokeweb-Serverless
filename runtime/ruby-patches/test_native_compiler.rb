# frozen_string_literal: true
require 'minitest/autorun'
require_relative 'native_compiler'

class RubyNativeCompilerTest < Minitest::Test
  def compile(body, params: 'request', options: 'returns: "bool", args: { request: "Request *" }')
    RubyPatch::NativeCompiler.new("signature :test, #{options}\ndef test(#{params})\n#{body}\nend\n").compile
  end

  def test_record_reference_and_memory_lvalues
    output = compile('assign(cast("InfoView &", deref(request)), aggregate("InfoView"))\nreturn truth(request)'.gsub('\\n', "\n"))
    assert_includes output, 'static_cast<InfoView &>((*request)) = InfoView{}'
    assert_includes output, 'static_cast<bool>(request)'
    output = compile('request.magic = 0\nassign(mem("u16", request, 4), 7)\nreturn true'.gsub('\\n', "\n"))
    assert_includes output, 'rb_object(request).magic = 0'
    assert_includes output, 'at<u16>(request, 4) = 7'
  end

  def test_native_binding_and_condition
    output = compile('if request.magic == 0\nreturn false\nend\nreturn invoke(native("bool(*)(void*)", 0x02001001, 0x02002001), request)'.gsub('\\n', "\n"))
    assert_includes output, 'if (rb_object(request).magic == 0)'
    assert_includes output, 'native<bool(*)(void*)>(0x02001001, 0x02002001)'
  end

  def test_defaults_and_parameter_contract
    output = compile('return width', params: 'width', options: 'returns: "u32", args: { width: "u32" }, defaults: { width: 46 }')
    assert_includes output, 'u32 test(u32 width = 46);'
    assert_includes output, 'u32 test(u32 width) {'
    error = assert_raises(RubyPatch::Error) { compile('return true', params: 'different') }
    assert_includes error.message, 'parameter names/order'
  end

  def test_rejects_dynamic_ruby_and_body_escapes
    ['class Runtime; end', 'system("unexpected")'].each do |source|
      assert_raises(RubyPatch::Error) { RubyPatch::NativeCompiler.new(source).compile }
    end
    ['return [1, 2]', 'return "#{request}"', 'local(:x, "u32; system()", 0)\nreturn true'].each do |body|
      assert_raises(RubyPatch::Error) { compile(body.gsub('\\n', "\n")) }
    end
  end

  def test_all_learnset_sources_parse_without_execution
    Dir[File.join(__dir__, 'learnset', '*.rb')].each do |path|
      output = RubyPatch::NativeCompiler.new(File.read(path)).compile
      assert_includes output, 'Generated from typed Ruby source'
    end
  end
end
