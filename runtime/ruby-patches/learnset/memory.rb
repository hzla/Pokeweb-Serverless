# Parsed typed Ruby source; edit this file, then rebuild.

signature :memcpy, returns: "void *", args: { dst: "void *", src: "const void *", size: "size_t" }, scope: "global", qualifiers: ["extern_c"]
def memcpy(dst, src, size)
  local(:d, "auto*", cast("unsigned char *", dst))
  local(:s, "auto*", cast("const unsigned char *", src))
  for_loop(local(:i, "size_t", 0), (i < size), pre_inc(i)) do
    d[i] = s[i]
  end
  return dst
end

signature :memset, returns: "void *", args: { dst: "void *", value: "int", size: "size_t" }, scope: "global", qualifiers: ["extern_c"]
def memset(dst, value, size)
  local(:d, "auto*", cast("unsigned char *", dst))
  for_loop(local(:i, "size_t", 0), (i < size), pre_inc(i)) do
    d[i] = cast("unsigned char", value)
  end
  return dst
end
