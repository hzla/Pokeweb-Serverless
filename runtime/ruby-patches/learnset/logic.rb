# Parsed typed Ruby source; edit this file, then rebuild.

# Visit eligible party slots in native order, with a bounded scan.
signature :nextPartySlot, returns: "u32", args: { current: "u32", count: "u32", forward: "bool", eligible: "Eligible" }, scope: "learnset", qualifiers: ["inline"], templates: ["Eligible"]
def nextPartySlot(current, count, forward, eligible)
  if (((count < 2) || (count > 6)) || (current >= count))
    return current
  end
  local(:slot, "u32", current)
  for_loop(local(:visited, "u32", 1), (visited < count), pre_inc(visited)) do
    slot = (forward ? (((slot + 1) == count) ? 0 : (slot + 1)) : (truth(slot) ? (slot - 1) : (count - 1)))
    if eligible(slot)
      return slot
    end
  end
  return current
end

signature :read16, returns: "u16", args: { p: "const u8 *" }, scope: "learnset", qualifiers: ["inline"]
def read16(p)
  return cast("u16", (p[0] | (cast("u16", p[1]) << 8)))
end

signature :read32, returns: "u32", args: { p: "const u8 *" }, scope: "learnset", qualifiers: ["inline"]
def read32(p)
  return (read16(p) | (cast("u32", read16((p + 2))) << 16))
end

# Validate NARC blocks and member bounds before reading edited ROM data.
signature :readMember, returns: "u32", args: { size: "u32", member: "u32", out: "u8 *", capacity: "u32", read: "Read" }, scope: "learnset", qualifiers: ["inline"], templates: ["Read"]
def readMember(size, member, out, capacity, read)
  local(:header, "u8[16]")
  local(:block, "auto", callback(returns: "auto", args: { offset: "u32", data: "u8 *", length: "u32" }) do
  return (((offset <= size) && (length <= (size - offset))) && read(offset, data, length))
end)
  if ((((((!block(0, header, 16)) || (read32(header) != 1129464142)) || (read32((header + 4)) != 16842750)) || (read32((header + 8)) != size)) || (read16((header + 12)) != 16)) || (read16((header + 14)) != 3))
    return 0
  end
  if ((!block(16, header, 12)) || (read32(header) != 1178686530))
    return 0
  end
  local(:fatSize, "const u32", read32((header + 4)))
  local(:count, "const u32", read16((header + 8)))
  if (((fatSize < (12 + (count * 8))) || (fatSize > (size - 16))) || (member >= count))
    return 0
  end
  if (!block((28 + (member * 8)), header, 8))
    return 0
  end
  local(:start, "const u32", read32(header))
  local(:last, "const u32", read32((header + 4)))
  local(:offset, "u32", (16 + fatSize))
  if ((!block(offset, header, 8)) || (read32(header) != 1179538498))
    return 0
  end
  local(:nameSize, "const u32", read32((header + 4)))
  if ((nameSize < 8) || (nameSize > (size - offset)))
    return 0
  end
  offset = (offset + nameSize)
  if ((!block(offset, header, 8)) || (read32(header) != 1179209031))
    return 0
  end
  local(:imageSize, "const u32", read32((header + 4)))
  if (((((((imageSize < 8) || (imageSize != (size - offset))) || (start > last)) || (last > (imageSize - 8))) || ((last - start) > capacity)) || (!truth(last))) || (last == start))
    return 0
  end
  return (block(((offset + 8) + start), out, (last - start)) ? (last - start) : 0)
end

# Keep unique move/level pairs, sorted by level; reject malformed records.
signature :parse, returns: "List", args: { bytes: "const u8 *", length: "u32", moveCount: "u32" }, scope: "learnset", qualifiers: ["inline"]
def parse(bytes, length, moveCount)
  local(:result, "List", aggregate("List"))
  result.status = enum_value("Status", "Unavailable")
  if ((((!truth(bytes)) || (length < 4)) || (length > ((MaxEntries + 1) * 4))) || truth((length & 3)))
    return result
  end
  local(:terminated, "bool", false)
  for_loop(local(:offset, "u32", 0), (offset < length), assign(offset, (offset + 4))) do
    local(:entry, "Entry", aggregate("Entry", read16((bytes + offset)), read16(((bytes + offset) + 2))))
    if ((entry.moveId == End) && (entry.level == End))
      terminated = true
      break
    end
    if ((((!truth(entry.moveId)) || (entry.moveId >= moveCount)) || (entry.level > 100)) || ((offset / 4) >= MaxEntries))
      result.count = 0
      return result
    end
    local(:duplicate, "bool", false)
    for_loop(local(:i, "u32", 0), (i < result.count), pre_inc(i)) do
      if ((result.entries[i].moveId == entry.moveId) && (result.entries[i].level == entry.level))
        duplicate = true
      end
    end
    if duplicate
      next
    end
    local(:pos, "u32", post_inc(result.count))
    while (truth(pos) && (result.entries[(pos - 1)].level > entry.level))
      result.entries[pos] = result.entries[(pos - 1)]
      pre_dec(pos)
    end
    result.entries[pos] = entry
  end
  if (!terminated)
    result.count = 0
    return result
  end
  result.status = (truth(result.count) ? enum_value("Status", "Ready") : enum_value("Status", "Empty"))
  return result
end

signature :canAppend, returns: "bool", args: { input: "const u32 *", expandedCount: "u32", fieldMode: "bool" }, scope: "learnset", qualifiers: ["inline"]
def canAppend(input, expandedCount, fieldMode)
  if ((((((((!fieldMode) || (!truth(input))) || (expandedCount == 0)) || (expandedCount >= 8)) || (input[0] != 0)) || (input[1] != 1)) || (input[2] != 3)) || ((input[3] != 4) && (input[3] != 5)))
    return false
  end
  for_loop(local(:i, "u32", 4), (i < 7), pre_inc(i)) do
    if (input[i] == 6)
      return (input[(i + 1)] == 16)
    end
    if ((input[i] != 7) && (input[i] != 11))
      return false
    end
  end
  return false
end

signature :decimal, returns: "u32", args: { out: "u16 *", value: "u32" }, scope: "learnset", qualifiers: ["inline"]
def decimal(out, value)
  local(:places, "const u32[10]", aggregate("const u32[10]", 1000000000, 100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1))
  local(:count, "u32", 0)
  each_native(places, :place, "u32") do
    local(:digit, "u16", cast("char", 48))
    while (value >= place)
      value = (value - place)
      pre_inc(digit)
    end
    if ((truth(count) || (digit != cast("char", 48))) || (place == 1))
      out[post_inc(count)] = digit
    end
  end
  return count
end

# Fit level and move labels within the native list column.
signature :label, returns: "void", args: { out: "u16 *", capacity: "u32", level: "u16", name: "const u16 *", width: "u32", measure: "Measure" }, scope: "learnset", qualifiers: ["inline"], templates: ["Measure"]
def label(out, capacity, level, name, width, measure)
  if (capacity < 12)
    return
  end
  local(:prefix, "u32", decimal(out, level))
  out[post_inc(prefix)] = cast("char", 32)
  out[post_inc(prefix)] = cast("char", 45)
  out[post_inc(prefix)] = cast("char", 32)
  local(:last, "u32", prefix)
  while (((deref(name) != End) && truth(deref(name))) && ((last + 4) < capacity))
    out[post_inc(last)] = deref(post_inc(name))
  end
  out[last] = End
  if (((deref(name) == End) || (!truth(deref(name)))) && (measure(out) <= width))
    return
  end
  do_while(true) do
    out[last] = cast("char", 46)
    out[(last + 1)] = cast("char", 46)
    out[(last + 2)] = cast("char", 46)
    out[(last + 3)] = End
    if ((measure(out) <= width) || (last == prefix))
      break
    end
    pre_dec(last)
  end
end
