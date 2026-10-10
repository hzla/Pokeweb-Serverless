# frozen_string_literal: true

# Typed record dialect for native patches. This parses Ruby; it never evals it.
# Types/ABI records are supplied by a reviewed header. No raw C/C++ body escape.
require_relative 'compiler'

module RubyPatch
  class NativeCompiler < Compiler
    OPERATORS = %w[+ - * / % & | ^ << >> < <= > >= == != && ||].freeze

    def initialize(source, includes: [])
      super(source, {}, '')
      @includes = includes
      @decls = {}
    end

    def compile
      @tree[1].each do |node|
        next unless command_name(node) == 'signature'
        args = args_list(node[2])
        name = literal(args[0]).to_s
        raise Error, "duplicate signature #{name}" if @decls.key?(name)
        options = literal(args[1])
        @decls[name] = options
      end
      output = ['/* Generated from typed Ruby source. */']
      @includes.each do |header|
        raise Error, 'invalid include' unless header.match?(/\A[\w.\/-]+\z/) && !header.include?('..')
        output << "#include \"#{header}\""
      end
      output << ''
      @decls.each do |name, options|
        next if options[:owner]
        output << scoped(options, declaration(name, options, prototype: true) + ';')
      end
      seen = []
      @tree[1].each do |node|
        next if node[0] == :void_stmt || command_name(node) == 'signature'
        if node[0] == :def
          name = node[1][1]
          options = @decls.fetch(name) { fail_at("missing signature for #{name}", node) }
          params = node.dig(2, 1)
          unless params && params[0] == :params && params.drop(2).all?(&:nil?) &&
                 (params[1] || []).map { |token| token[1] } == options.fetch(:args).keys.map(&:to_s)
            fail_at('parameter names/order must match signature', node)
          end
          fail_at("duplicate function #{name}", node) if seen.include?(name)
          seen << name
          body = node[3]
          fail_at('rescue/ensure unsupported', body) unless body[0] == :bodystmt && body.drop(2).all?(&:nil?)
          output << scoped(options, declaration(name, options) + " {\n" + statements_native(body[1], 1) + "\n}")
        elsif command_name(node) == 'global'
          args = args_list(node[2])
          name, options = literal(args[0]).to_s, literal(args[1])
          init = args.length == 3 ? expr(args[2]) : nil
          text = typed_name(options.fetch(:type), name)
          if options[:section]
            section = options[:section]
            fail_at('invalid section', node) unless section.match?(/\A\.[a-zA-Z_0-9]+\z/)
            text = "__attribute__((used,section(\"#{section}\"))) " + text
          end
          text += " = #{init}" if init
          text += ';'
          text = "extern \"C\" { #{text} }" if options[:export]
          output << scoped(options, text)
        else
          fail_at('top level accepts signature, global and def', node)
        end
      end
      raise Error, 'signature missing definition' unless seen.sort == @decls.keys.sort
      output.join("\n\n") + "\n"
    end

    private

    def command_name(node)
      node && node[0] == :command ? node[1][1] : nil
    end

    def literal(node)
      if node && node[0] == :symbol_literal
        token = node.dig(1, 1)
        if token && %i[@ident @const].include?(token[0])
          return name(token[1]).to_sym
        end
      end
      if node && node[0] == :string_literal
        parts = node[1]
        fail_at('interpolation unsupported', node) unless parts[0] == :string_content && parts.drop(1).all? { |part| part[0] == :@tstring_content }
        # The dialect deliberately accepts JSON-compatible double-quoted strings.
        return JSON.parse('"' + parts.drop(1).map { |part| part[1] }.join + '"')
      end
      return Integer(node[1]) if node && node[0] == :@int
      if node && node[0] == :var_ref && node[1][0] == :@kw
        return true if node[1][1] == 'true'
        return false if node[1][1] == 'false'
        return nil if node[1][1] == 'nil'
      end
      super
    end

    def ctype(value)
      unless value.is_a?(String) && value.match?(/\A[A-Za-z_][A-Za-z_0-9 :<>,*&()\[\]]*\z/)
        raise Error, "invalid native type #{value.inspect}"
      end
      value
    end

    def name(value)
      raise Error, 'invalid native identifier' unless value.is_a?(String) && value.match?(/\A[a-zA-Z_][a-zA-Z_0-9]*\z/)
      value
    end

    def typed_name(type, variable)
      type = ctype(type)
      variable = name(variable)
      if type =~ /\A(.+?)(\[.*\])\z/
        "#{Regexp.last_match(1)} #{variable}#{Regexp.last_match(2)}"
      elsif type.include?('(*)')
        type.sub('(*)', "(*#{variable})")
      else
        "#{type} #{variable}"
      end
    end

    def scoped(options, text)
      case options[:scope]
      when nil, 'global' then text
      when 'private' then "namespace {\n#{text}\n}"
      else
        "namespace #{name(options[:scope])} {\n#{text}\n}"
      end
    end

    def declaration(alias_name, options, prototype: false)
      cpp_name = options.fetch(:cpp_name, alias_name)
      destructor = cpp_name.start_with?('~')
      name(destructor ? cpp_name.delete_prefix('~') : cpp_name)
      cpp_name = "#{name(options[:owner])}::#{cpp_name}" if options[:owner] && !prototype
      params = options.fetch(:args).map do |arg, type|
        parameter = typed_name(type, arg.to_s)
        defaults = options[:defaults] || {}
        if prototype && defaults.key?(arg)
          value = defaults[arg]
          default = case value
                    when Integer then value.to_s
                    when true, false then value.to_s
                    when nil then 'nullptr'
                    when String then name(value)
                    else raise Error, 'invalid parameter default'
                    end
          parameter += " = #{default}"
        end
        parameter
      end.join(', ')
      qualifiers = (options[:qualifiers] || []).map do |item|
        raise Error, 'invalid function qualifier' unless %w[inline constexpr extern_c].include?(item)
        item == 'extern_c' ? 'extern "C"' : item
      end
      returns = destructor ? '' : ctype(options.fetch(:returns)) + ' '
      templates = options[:templates] || []
      prefix = templates.empty? ? '' : "template<#{templates.map { |item| 'class ' + name(item) }.join(', ')}>\n"
      # Defaults are declared in the ABI records or passed explicitly by sources.
      prefix + ([*qualifiers, returns + cpp_name + "(#{params})"].join(' '))
    end

    def statement_call(node)
      node[0] == :method_add_arg ? node : [:method_add_arg, [:fcall, node[1]], [:arg_paren, node[2]]]
    end

    def block_parts(node)
      block = node[2]
      fail_at('expected do block', node) unless block[0] == :do_block
      body = block[2]
      fail_at('rescue/ensure unsupported in blocks', block) unless body[0] == :bodystmt && body.drop(2).all?(&:nil?)
      [block[1], body[1]]
    end

    def statements_native(nodes, depth)
      (nodes || []).filter_map do |node|
        next if node[0] == :void_stmt
        pad = '  ' * depth
        case node[0]
        when :if
          yes = statements_native(node[2], depth + 1)
          tail = node[3]
          fail_at('use nested if instead of elsif', tail) if tail && tail[0] != :else
          text = "#{pad}if (#{condition_expr(node[1])}) {\n#{yes}\n#{pad}}"
          text += " else {\n#{statements_native(tail[1], depth + 1)}\n#{pad}}" if tail
          text
        when :while
          "#{pad}while (#{condition_expr(node[1])}) {\n#{statements_native(node[2], depth + 1)}\n#{pad}}"
        when :return0 then "#{pad}return;"
        when :return
          args = args_list(node[1])
          fail_at('return needs one value', node) unless args.length == 1
          "#{pad}return #{expr(args[0])};"
        when :break then "#{pad}break;"
        when :next then "#{pad}continue;"
        when :assign then "#{pad}#{expr(node[1])} = #{expr(node[2])};"
        when :opassign then "#{pad}#{expr(node[1])} #{node[2][1]} #{expr(node[3])};"
        when :method_add_block
          call = node[1]
          call_name, args = call_parts(call)
          _params, body = block_parts(node)
          case call_name
          when 'for_loop'
            fail_at('for_loop needs initializer, condition, step', node) unless args.length == 3
            "#{pad}for (#{expr(args[0])}; #{condition_expr(args[1])}; #{expr(args[2])}) {\n#{statements_native(body, depth + 1)}\n#{pad}}"
          when 'each_native'
            fail_at('each_native needs range, variable and type', node) unless args.length == 3
            "#{pad}for (#{typed_name(literal(args[2]), literal(args[1]).to_s)} : #{expr(args[0])}) {\n#{statements_native(body, depth + 1)}\n#{pad}}"
          when 'do_while'
            "#{pad}do {\n#{statements_native(body, depth + 1)}\n#{pad}} while (#{condition_expr(args.fetch(0))});"
          when 'scope'
            "#{pad}{\n#{statements_native(body, depth + 1)}\n#{pad}}"
          else
            fail_at('unsupported statement block', node)
          end
        when :case
          text = "#{pad}switch (#{expr(node[1])}) {\n"
          tail = node[2]
          while tail
            if tail[0] == :when
              tail[1].each { |item| text += "#{pad}case #{expr(item)}:\n" }
              text += statements_native(tail[2], depth + 1) + "\n#{pad}  break;\n"
              tail = tail[3]
            elsif tail[0] == :else
              text += "#{pad}default:\n#{statements_native(tail[1], depth + 1)}\n#{pad}  break;\n"
              tail = nil
            else
              fail_at('unsupported case clause', tail)
            end
          end
          text + pad + '}'
        else
          "#{pad}#{expr(node[0] == :command ? statement_call(node) : node)};"
        end
      end.join("\n")
    end

    def condition_expr(node)
      while node[0] == :paren && node[1].length == 1
        node = node[1][0]
      end
      text = expr(node)
      %i[binary unary ifop].include?(node[0]) ? text[1...-1] : text
    end

    def call_parts(node)
      fail_at('parenthesized plain call required', node) unless node[0] == :method_add_arg && node[1][0] == :fcall
      [node[1][1][1], args_list(node[2])]
    end

    def expr(node)
      fail_at('missing expression', node) unless node.is_a?(Array)
      case node[0]
      when :@int then node[1]
      when :string_literal then JSON.generate(literal(node))
      when :var_ref, :var_field, :vcall
        token = node[1]
        if token[0] == :@kw
          return { 'nil' => 'nullptr', 'true' => 'true', 'false' => 'false', 'self' => '(*this)' }.fetch(token[1]) { fail_at('unsupported keyword', node) }
        end
        name(token[1])
      when :paren
        fail_at('one parenthesized expression required', node) unless node[1].length == 1
        "(#{expr(node[1][0])})"
      when :binary
        fail_at('unsupported binary operator', node) unless OPERATORS.include?(node[2].to_s)
        "(#{expr(node[1])} #{node[2]} #{expr(node[3])})"
      when :unary
        op = { :! => '!', :~ => '~', :-@ => '-', :+@ => '+' }[node[1]]
        fail_at('unsupported unary operator', node) unless op
        "(#{op}#{expr(node[2])})"
      when :ifop then "(#{expr(node[1])} ? #{expr(node[2])} : #{expr(node[3])})"
      when :call, :field
        "rb_object(#{expr(node[1])}).#{name(node[3][1])}"
      when :aref, :aref_field
        args = args_list(node[2])
        fail_at('one index required', node) unless args.length == 1
        "#{expr(node[1])}[#{expr(args[0])}]"
      when :method_add_arg
        if node[1][0] == :call
          return "#{expr(node[1])}(#{args_list(node[2]).map { |arg| expr(arg) }.join(', ')})"
        end
        function, args = call_parts(node)
        case function
        when 'local'
          variable, type = literal(args[0]).to_s, literal(args[1])
          result = typed_name(type, variable)
          result += " = #{expr(args[2])}" if args.length > 2
          result
        when 'aggregate'
          type = ctype(literal(args[0]))
          values = args.drop(1).map { |arg| expr(arg) }.join(', ')
          type.include?('[') ? "{#{values}}" : "#{type.sub(/\A(?:const |volatile )+/, '')}{#{values}}"
        when 'construct'
          type = ctype(literal(args[0])).sub(/\A(?:const |volatile )+/, '')
          if type == 'auto'
            fail_at('auto copy needs one value', node) unless args.length == 2
            expr(args[1])
          else
            "#{type}(#{args.drop(1).map { |arg| expr(arg) }.join(', ')})"
          end
        when 'cast', 'reinterpret'
          cast = function == 'cast' ? 'static_cast' : 'reinterpret_cast'
          "#{cast}<#{ctype(literal(args[0]))}>(#{expr(args.fetch(1))})"
        when 'native', 'mem'
          "#{function == 'mem' ? 'at' : 'native'}<#{ctype(literal(args[0]))}>(#{args.drop(1).map { |arg| expr(arg) }.join(', ')})"
        when 'invoke'
          "(#{expr(args.fetch(0))})(#{args.drop(1).map { |arg| expr(arg) }.join(', ')})"
        when 'enum_value'
          "#{name(literal(args[0]))}::#{name(literal(args[1]))}"
        when 'address_of' then "(&#{expr(args.fetch(0))})"
        when 'deref' then "(*#{expr(args.fetch(0))})"
        when 'truth' then "static_cast<bool>(#{expr(args.fetch(0))})"
        when 'size_of' then "sizeof(#{ctype(literal(args.fetch(0)))})"
        when 'size_of_expr' then "sizeof(#{expr(args.fetch(0))})"
        when 'pre_inc', 'post_inc', 'pre_dec', 'post_dec'
          op = function.end_with?('inc') ? '++' : '--'
          function.start_with?('pre') ? "(#{op}#{expr(args.fetch(0))})" : "(#{expr(args.fetch(0))}#{op})"
        when 'assign' then "(#{expr(args.fetch(0))} = #{expr(args.fetch(1))})"
        when 'record'
          fields = literal(args[1])
          "struct #{name(literal(args[0]))} { #{fields.map { |field, type| typed_name(type, field.to_s) + ';' }.join(' ')} }"
        else
          "#{name(function)}(#{args.map { |arg| expr(arg) }.join(', ')})"
        end
      when :method_add_block
        function, args = call_parts(node[1])
        fail_at('only callback expression blocks are supported', node) unless function == 'callback'
        options = literal(args.fetch(0))
        _params, body = block_parts(node)
        params = options.fetch(:args).map { |arg, type| typed_name(type, arg.to_s) }.join(', ')
        "[&](#{params}) -> #{ctype(options.fetch(:returns))} {\n#{statements_native(body, 1)}\n}"
      else
        fail_at("unsupported native expression #{node[0]}", node)
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  options = { includes: [] }
  parser = OptionParser.new do |opts|
    opts.on('--source PATH') { |value| options[:source] = value }
    opts.on('--output PATH') { |value| options[:output] = value }
    opts.on('--include NAME') { |value| options[:includes] << value }
  end
  begin
    parser.parse!
    raise RubyPatch::Error, 'source and output required' unless options[:source] && options[:output] && ARGV.empty?
    result = RubyPatch::NativeCompiler.new(File.read(options[:source]), includes: options[:includes]).compile
    File.write(options[:output], result)
  rescue RubyPatch::Error, KeyError, ArgumentError, JSON::ParserError, SystemCallError => error
    warn "RubyPatch native: #{error.message}"
    exit 1
  end
end
