# Parsed typed Ruby source; edit this file, then rebuild.

signature :parseEvolutions, returns: "Evolutions", args: { data: "const u8 *", length: "u32", count: "u32" }, scope: "learnset", qualifiers: ["inline"]
def parseEvolutions(data, length, count)
  local(:out, "Evolutions", aggregate("Evolutions"))
  if ((!truth(data)) || ((length != 42) && (length != 48)))
    return out
  end
  for_loop(local(:i, "u32", 0), (i < length), assign(i, (i + 6))) do
    local(:e, "Evolution", aggregate("Evolution", read16((data + i)), read16(((data + i) + 2)), read16(((data + i) + 4))))
    if (!truth(e.method))
      next
    end
    if ((!truth(e.target)) || (e.target >= count))
      return aggregate("Evolutions")
    end
    out.entries[post_inc(out.count)] = e
  end
  out.valid = true
  return out
end

signature :infoAbilities, returns: "Abilities", args: { slots: "const u8 *" }, scope: "learnset", qualifiers: ["inline"]
def infoAbilities(slots)
  local(:out, "Abilities", aggregate("Abilities"))
  for_loop(local(:slot, "u32", 0), (slot < 3), pre_inc(slot)) do
    if (!truth(slots[slot]))
      next
    end
    local(:index, "u32", 0)
    while ((index < out.count) && (out.ids[index] != slots[slot]))
      pre_inc(index)
    end
    if (index == out.count)
      out.ids[post_inc(out.count)] = slots[slot]
    end
    if (slot == 2)
      out.hidden[index] = true
    end
  end
  return out
end

signature :sameNode, returns: "bool", args: { nodes: "const InfoNode *", a: "u16", b: "u16" }, scope: "learnset", qualifiers: ["inline"]
def sameNode(nodes, a, b)
  return ((nodes[a].species == nodes[b].species) && (nodes[a].form == nodes[b].form))
end

# Build a three-node preview without following a repeated identity.
signature :infoChain, returns: "Chain", args: { nodes: "const InfoNode *", count: "u32", selected: "u16", outgoing: "u16" }, scope: "learnset", qualifiers: ["inline"], defaults: { outgoing: "End" }
def infoChain(nodes, count, selected, outgoing)
  local(:c, "Chain", aggregate("Chain"))
  if ((((!truth(nodes)) || (!truth(selected))) || (selected >= count)) || (!nodes[selected].valid))
    return c
  end
  c.ids[0] = selected
  c.count = 1
  local(:admissible, "auto", callback(returns: "bool", args: { id: "u16" }) do
  if (((!truth(id)) || (id >= count)) || (!nodes[id].valid))
    return false
  end
  for_loop(local(:i, "u32", 0), (i < c.count), pre_inc(i)) do
    if sameNode(nodes, id, c.ids[i])
      return false
    end
  end
  return true
end)
  local(:prepend, "auto", callback(returns: "void", args: { id: "u16" }) do
  for_loop(local(:i, "u32", c.count), truth(i), pre_dec(i)) do
    c.ids[i] = c.ids[(i - 1)]
  end
  c.ids[0] = id
  pre_inc(c.count)
  pre_inc(c.selected)
end)
  local(:parent, "const u16", nodes[selected].parent)
  local(:next_value, "const u16", ((outgoing == End) ? nodes[selected].next : outgoing))
  if invoke(admissible, parent)
    invoke(prepend, parent)
  end
  if invoke(admissible, next_value)
    c.ids[post_inc(c.count)] = next_value
  end
  if (c.count < 3)
    if ((c.selected + 1) < c.count)
      local(:id, "const u16", nodes[c.ids[(c.count - 1)]].next)
      if invoke(admissible, id)
        c.ids[post_inc(c.count)] = id
      end
    else
      if truth(c.selected)
        local(:id, "const u16", nodes[c.ids[0]].parent)
        if invoke(admissible, id)
          invoke(prepend, id)
        end
      end
    end
  end
  c.before = invoke(admissible, nodes[c.ids[0]].parent)
  c.after = invoke(admissible, ((c.ids[(c.count - 1)] == selected) ? next_value : nodes[c.ids[(c.count - 1)]].next))
  return c
end

signature :familyTargets, returns: "u32", args: { nodes: "const InfoNode *", count: "u32", e: "const Evolutions &", ids: "u16 *" }, scope: "learnset", qualifiers: ["inline"]
def familyTargets(nodes, count, e, ids)
  if (!e.valid)
    return 0
  end
  local(:n, "u32", 0)
  for_loop(local(:i, "u32", 0), ((i < e.count) && (i < 8)), pre_inc(i)) do
    local(:id, "const u16", e.entries[i].target)
    if (((!truth(id)) || (id >= count)) || (!nodes[id].valid))
      next
    end
    local(:duplicate, "bool", false)
    for_loop(local(:j, "u32", 0), (j < n), pre_inc(j)) do
      if sameNode(nodes, id, ids[j])
        duplicate = true
      end
    end
    if (!duplicate)
      ids[post_inc(n)] = id
    end
  end
  return n
end

# Browse descendants and siblings with a bounded cycle guard.
signature :familyStep, returns: "FamilyStep", args: { nodes: "const InfoNode *", count: "u32", selected: "u16", forward: "bool", read: "Read" }, scope: "learnset", qualifiers: ["inline"], templates: ["Read"]
def familyStep(nodes, count, selected, forward, read)
  if (((((!truth(nodes)) || (count > MaxPersonal)) || (!truth(selected))) || (selected >= count)) || (!nodes[selected].valid))
    return aggregate("FamilyStep")
  end
  local(:targets, "u16[8]")
  if forward
    local(:n, "const u32", familyTargets(nodes, count, read(selected), targets))
    for_loop(local(:i, "u32", 0), (i < n), pre_inc(i)) do
      if (!sameNode(nodes, targets[i], selected))
        return aggregate("FamilyStep", targets[i], selected)
      end
    end
  end
  local(:visited, "u8[512]", aggregate("u8[512]"))
  local(:current, "u16", selected)
  for_loop(local(:depth, "u32", 0), (depth < count), pre_inc(depth)) do
    if truth((visited[(current / 8)] & (cast("unsigned int", 1) << (current & 7))))
      break
    end
    visited[(current / 8)] = (visited[(current / 8)] | (cast("unsigned int", 1) << (current & 7)))
    local(:parent, "const u16", nodes[current].parent)
    if ((((!truth(parent)) || (parent >= count)) || (!nodes[parent].valid)) || sameNode(nodes, parent, current))
      break
    end
    local(:n, "const u32", familyTargets(nodes, count, read(parent), targets))
    local(:at, "u32", 0)
    while ((at < n) && (!sameNode(nodes, targets[at], current)))
      pre_inc(at)
    end
    if (!forward)
      if ((at < n) && truth(at))
        return aggregate("FamilyStep", targets[(at - 1)], parent)
      end
      return aggregate("FamilyStep", parent, nodes[parent].parent)
    end
    for_loop(local(:i, "u32", (at + 1)), (i < n), pre_inc(i)) do
      if (!sameNode(nodes, targets[i], selected))
        return aggregate("FamilyStep", targets[i], parent)
      end
    end
    current = parent
  end
  return aggregate("FamilyStep")
end

signature :statBar, returns: "u32", args: { value: "u32", width: "u32" }, scope: "learnset", qualifiers: ["inline"], defaults: { width: 46 }
def statBar(value, width)
  local(:scaled, "u32", ((value * width) + 127))
  local(:result, "u32", 0)
  while (scaled >= 255)
    scaled = (scaled - 255)
    pre_inc(result)
  end
  return result
end

signature :copyText, returns: "u32", args: { out: "u16 *", capacity: "u32", input_text: "const u16 *" }, scope: "learnset", qualifiers: ["inline"]
def copyText(out, capacity, input_text)
  if (!truth(capacity))
    return 0
  end
  local(:n, "u32", 0)
  if truth(input_text)
    while ((truth(input_text[n]) && (input_text[n] != End)) && ((n + 1) < capacity))
      out[n] = input_text[n]
      pre_inc(n)
    end
  end
  out[n] = End
  return n
end

signature :asciiText, returns: "void", args: { out: "u16 *", capacity: "u32", input_text: "const char *" }, scope: "learnset", qualifiers: ["inline"]
def asciiText(out, capacity, input_text)
  local(:n, "u32", 0)
  while (truth(deref(input_text)) && ((n + 1) < capacity))
    out[post_inc(n)] = cast("u8", deref(post_inc(input_text)))
  end
  if truth(capacity)
    out[n] = End
  end
end

signature :infoUpper, returns: "u16", args: { c: "u16" }, scope: "learnset", qualifiers: ["inline"]
def infoUpper(c)
  if ((((c >= cast("char", 97)) && (c <= cast("char", 122))) || ((c >= 224) && (c <= 246))) || ((c >= 248) && (c <= 254)))
    return (c - 32)
  end
  if (c == 255)
    return 376
  end
  if (c == 339)
    return 338
  end
  return c
end

signature :infoLower, returns: "u16", args: { c: "u16" }, scope: "learnset", qualifiers: ["inline"]
def infoLower(c)
  if ((((c >= cast("char", 65)) && (c <= cast("char", 90))) || ((c >= 192) && (c <= 214))) || ((c >= 216) && (c <= 222)))
    return (c + 32)
  end
  if (c == 376)
    return 255
  end
  if (c == 338)
    return 339
  end
  return c
end

signature :infoTitleCase, returns: "void", args: { text: "u16 *" }, scope: "learnset", qualifiers: ["inline"]
def infoTitleCase(text)
  local(:first, "bool", true)
  for_loop(local(:i, "u32", 0), (truth(text[i]) && (text[i] != End)), pre_inc(i)) do
    local(:c, "const u16", text[i])
    local(:upper, "const u16", infoUpper(c))
    local(:lower, "const u16", infoLower(c))
    if (upper != lower)
      text[i] = (first ? upper : lower)
      first = false
    else
      if (((c != cast("char", 39)) && (c != 8217)) && (!((c >= cast("char", 48)) && (c <= cast("char", 57)))))
        first = true
      end
    end
  end
end

# Substitute private requirement text into fixed-capacity buffers.
signature :expandInfo, returns: "void", args: { out: "u16 *", capacity: "u32", format: "const u16 *", a: "const u16 *", b: "const u16 *" }, scope: "learnset", qualifiers: ["inline"], defaults: { b: nil }
def expandInfo(out, capacity, format, a, b)
  local(:n, "u32", 0)
  if (!truth(capacity))
    return
  end
  while (((truth(format) && (deref(format) != End)) && truth(deref(format))) && ((n + 1) < capacity))
    if (((format[0] == cast("char", 123)) && ((format[1] == cast("char", 48)) || (format[1] == cast("char", 49)))) && (format[2] == cast("char", 125)))
      local(:value, "const u16 *", ((format[1] == cast("char", 48)) ? a : b))
      if truth(value)
        while ((truth(deref(value)) && (deref(value) != End)) && ((n + 1) < capacity))
          out[post_inc(n)] = deref(post_inc(value))
        end
      end
      format = (format + 3)
    else
      out[post_inc(n)] = deref(post_inc(format))
    end
  end
  out[n] = End
end

# Wrap text and return the next continuation offset.
signature :wrapInfo, returns: "u32", args: { text: "const u16 *", start: "u32", line: "u16 *", capacity: "u32", width: "u32", measure: "Measure" }, scope: "learnset", qualifiers: ["inline"], templates: ["Measure"]
def wrapInfo(text, start, line, capacity, width, measure)
  local(:last, "u32", start)
  local(:n, "u32", 0)
  local(:space, "u32", 0)
  while ((((text[last] != End) && truth(text[last])) && (text[last] != cast("char", 10))) && ((n + 1) < capacity))
    line[post_inc(n)] = text[post_inc(last)]
    line[n] = End
    if (measure(line) > width)
      pre_dec(n)
      pre_dec(last)
      break
    end
    if (line[(n - 1)] == cast("char", 32))
      space = last
    end
  end
  if (((last == start) && (text[last] != End)) && truth(text[last]))
    line[0] = text[post_inc(last)]
    n = 1
  else
    if ((((text[last] != End) && truth(text[last])) && (text[last] != cast("char", 10))) && (space > start))
      last = space
      n = (last - start)
    end
  end
  while (truth(n) && (line[(n - 1)] == cast("char", 32)))
    pre_dec(n)
  end
  line[n] = End
  while ((text[last] == cast("char", 32)) || (text[last] == cast("char", 10)))
    pre_inc(last)
  end
  return last
end

signature :infoPixel, returns: "void", args: { pixels: "u8 *", x: "u32", y: "u32", color: "u8" }, scope: "learnset", qualifiers: ["inline"]
def infoPixel(pixels, x, y, color)
  if ((x >= 256) || (y >= 192))
    return
  end
  local(:offset, "const u32", ((((((y / 8) * 32) + (x / 8)) * 32) + ((y % 8) * 4)) + ((x % 8) / 2)))
  local(:shift, "const u32", ((x & 1) * 4))
  pixels[offset] = cast("u8", ((pixels[offset] & (~(cast("unsigned int", 15) << shift))) | ((color & cast("unsigned int", 15)) << shift)))
end

signature :infoRect, returns: "void", args: { pixels: "u8 *", x: "u32", y: "u32", w: "u32", h: "u32", color: "u8" }, scope: "learnset", qualifiers: ["inline"]
def infoRect(pixels, x, y, w, h, color)
  for_loop(local(:j, "u32", y), ((j < (y + h)) && (j < 192)), pre_inc(j)) do
    for_loop(local(:i, "u32", x), ((i < (x + w)) && (i < 256)), pre_inc(i)) do
      infoPixel(pixels, i, j, color)
    end
  end
end
