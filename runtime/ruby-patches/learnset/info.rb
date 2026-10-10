# Parsed typed Ruby source; edit this file, then rebuild.

global :Heap, { type: "constexpr const u32", scope: "private" }, 79

global :TextCapacity, { type: "constexpr const u32", scope: "private" }, 256

global :state, { type: "InfoState *", scope: "private" }

global :customRegions, { type: "u32", scope: "private" }, 63

# Bound filesystem reads and handle short reads without game assertions.
signature :Archive_read, returns: "bool", args: { offset: "u32", out: "void *", length: "u32" }, scope: "private", owner: "Archive", cpp_name: "read"
def Archive_read(offset, out, length)
  return ((((self.opened && (offset <= self.size)) && (length <= (self.size - offset))) && truth(invoke(native("u32(*)(void*,u32,u32)", 0x02070e55, 0x02070e29), self.file, offset, 0))) && (invoke(native("int(*)(void*,void*,u32)", 0x02070e6d, 0x02070e41), self.file, out, length) == cast("int", length)))
end

signature :Archive_open, returns: "bool", args: { path: "const char *" }, scope: "private", owner: "Archive", cpp_name: "open"
def Archive_open(path)
  invoke(native("void(*)(void*)", 0x02070ca9, 0x02070c7d), self.file)
  self.opened = (invoke(native("u32(*)(void*,const char*)", 0x02070ecd, 0x02070ea1), self.file, path) != 0)
  if (!self.opened)
    return false
  end
  self.size = invoke(native("u32(*)(void*)", 0x02070ded, 0x02070dc1), self.file)
  local(:h, "u8[16]")
  if ((((((!self.read(0, h, 16)) || (read32(h) != 1129464142)) || (read32((h + 4)) != 16842750)) || (read32((h + 8)) != self.size)) || (read16((h + 12)) != 16)) || (read16((h + 14)) != 3))
    return false
  end
  if ((!self.read(16, h, 12)) || (read32(h) != 1178686530))
    return false
  end
  local(:fat, "const u32", read32((h + 4)))
  self.count = read16((h + 8))
  if ((fat < (12 + (self.count * 8))) || (fat > (self.size - 16)))
    return false
  end
  local(:offset, "u32", (16 + fat))
  if ((!self.read(offset, h, 8)) || (read32(h) != 1179538498))
    return false
  end
  local(:names, "const u32", read32((h + 4)))
  if ((names < 8) || (names > (self.size - offset)))
    return false
  end
  offset = (offset + names)
  if ((((!self.read(offset, h, 8)) || (read32(h) != 1179209031)) || (read32((h + 4)) < 8)) || (read32((h + 4)) != (self.size - offset)))
    return false
  end
  self.image = (offset + 8)
  self.imageSize = (self.size - self.image)
  return true
end

signature :Archive_buffer, returns: "void", args: {  }, scope: "private", owner: "Archive", cpp_name: "buffer"
def Archive_buffer()
  self.cache = cast("Cache *", alloc(Heap, size_of("Cache")))
  if truth(self.cache)
    assign(deref(self.cache), aggregate("Cache"))
  end
end

signature :Archive_unbuffer, returns: "void", args: {  }, scope: "private", owner: "Archive", cpp_name: "unbuffer"
def Archive_unbuffer()
  release(self.cache)
  self.cache = nil
end

# Use fixed streaming windows; fall back to direct reads if unavailable.
signature :Archive_cachedRead, returns: "bool", args: { offset: "u32", out: "void *", length: "u32", fat: "bool" }, scope: "private", owner: "Archive", cpp_name: "cachedRead"
def Archive_cachedRead(offset, out, length, fat)
  if (!truth(self.cache))
    return self.read(offset, out, length)
  end
  local(:at, "u32 &", (fat ? self.cache.fatAt : self.cache.dataAt))
  local(:available, "u32 &", (fat ? self.cache.fatLength : self.cache.dataLength))
  local(:data, "u8 *", (fat ? self.cache.fat : self.cache.data))
  local(:capacity, "const u32", (fat ? size_of_expr(self.cache.fat) : size_of_expr(self.cache.data)))
  if ((offset > self.size) || (length > (self.size - offset)))
    return false
  end
  if (length > capacity)
    return self.read(offset, out, length)
  end
  if (((offset < at) || ((offset - at) > available)) || (length > (available - (offset - at))))
    at = offset
    available = (((self.size - offset) < capacity) ? (self.size - offset) : capacity)
    if (!self.read(at, data, available))
      available = 0
      return false
    end
  end
  local(:dest, "u8 *", cast("u8 *", out))
  for_loop(local(:i, "u32", 0), (i < length), pre_inc(i)) do
    dest[i] = data[((offset - at) + i)]
  end
  return true
end

signature :Archive_member, returns: "u32", args: { id: "u32", out: "void *", capacity: "u32", prefix: "bool" }, scope: "private", owner: "Archive", cpp_name: "member"
def Archive_member(id, out, capacity, prefix)
  local(:h, "u8[8]")
  if (((!truth(self.image)) || (id >= self.count)) || (!self.cachedRead((28 + (8 * id)), h, 8, true)))
    return 0
  end
  local(:first, "u32", read32(h))
  local(:last, "u32", read32((h + 4)))
  if ((((first > last) || (last > self.imageSize)) || (last == first)) || ((!prefix) && ((last - first) > capacity)))
    return 0
  end
  local(:length, "const u32", (((last - first) < capacity) ? (last - first) : capacity))
  return (self.cachedRead((self.image + first), out, length, false) ? length : 0)
end

signature :Archive_destroy, returns: "void", args: {  }, scope: "private", owner: "Archive", cpp_name: "~Archive"
def Archive_destroy()
  self.unbuffer()
  if self.opened
    invoke(native("u32(*)(void*)", 0x02070de1, 0x02070db5), self.file)
  end
end

# Keep one private text bank and one names bank open during loading.
signature :Messages_handle, returns: "void *", args: { bank: "u32", id: "u32" }, scope: "private", owner: "Messages", cpp_name: "handle"
def Messages_handle(bank, id)
  local(:ids, "const u16[6]", aggregate("const u16[6]", messageBank(401), messageBank(90), messageBank(64), messageBank(403), messageBank(487), messageBank(374)))
  local(:slot, "u32", 0)
  while ((slot < 6) && (ids[slot] != bank))
    pre_inc(slot)
  end
  if (slot == 6)
    return nil
  end
  local(:entry, "auto&", self.banks[slot])
  if (!entry.checked)
    local(:header, "u8[4]")
    entry.checked = true
    entry.valid = (self.member(bank, header, 4, true) == 4)
    if entry.valid
      entry.count = read16((header + 2))
    end
  end
  if ((!entry.valid) || (id >= entry.count))
    return nil
  end
  if (bank == messageBank(401))
    if (!truth(self.privateHandle))
      self.privateHandle = messageOpen(bank, Heap)
    end
    return self.privateHandle
  end
  if (truth(self.nameHandle) && (self.nameBank != bank))
    messageClose(self.nameHandle)
    self.nameHandle = nil
  end
  if (!truth(self.nameHandle))
    self.nameHandle = messageOpen(bank, Heap)
    self.nameBank = bank
  end
  return self.nameHandle
end

signature :Messages_destroy, returns: "void", args: {  }, scope: "private", owner: "Messages", cpp_name: "~Messages"
def Messages_destroy()
  if truth(self.privateHandle)
    messageClose(self.privateHandle)
  end
  if truth(self.nameHandle)
    messageClose(self.nameHandle)
  end
end

signature :bmp, returns: "void *", args: {  }, scope: "private"
def bmp()
  return invoke(native("void*(*)(void*)", 0x02048521, 0x020484f5), mem("void*", state.work, 56))
end

signature :pixels, returns: "u8 *", args: {  }, scope: "private"
def pixels()
  return invoke(native("u8*(*)(void*)", 0x02046f21, 0x02046ef5), bmp())
end

signature :put, returns: "void", args: { text: "const u16 *", x: "int", y: "int", color: "u32" }, scope: "private"
def put(text, x, y, color)
  local(:buffer, "void *", mem("void*", state.work, 76))
  stringSet(buffer, text)
  invoke(native("void(*)(void*,int,int,void*,void*,u32)", 0x02021d55, 0x02021d29), bmp(), x, y, buffer, mem("void*", state.work, 96), color)
end

signature :measure, returns: "u32", args: { text: "const u16 *" }, scope: "private"
def measure(text)
  local(:buffer, "void *", mem("void*", state.work, 76))
  stringSet(buffer, text)
  return invoke(native("u32(*)(void*,void*,u32)", 0x020228b5, 0x02022889), buffer, mem("void*", state.work, 96), 0)
end

signature :ellipsis, returns: "void", args: { text: "u16 *", width: "u32" }, scope: "private"
def ellipsis(text, width)
  local(:n, "u32", 0)
  while ((text[n] != End) && truth(text[n]))
    pre_inc(n)
  end
  if (measure(text) <= width)
    return
  end
  n = ((n > 3) ? (n - 3) : 0)
  do_while(true) do
    text[n] = cast("char", 46)
    text[(n + 1)] = cast("char", 46)
    text[(n + 2)] = cast("char", 46)
    text[(n + 3)] = End
    if ((measure(text) <= width) || (!truth(n)))
      break
    end
    pre_dec(n)
  end
end

signature :headerTypes, returns: "void", args: {  }, scope: "private"
def headerTypes()
  local(:width, "const u32", ((state.partyCue[0] == End) ? 240 : (232 - measure(state.partyCue))))
  local(:badges, "const u32", (truth(state.typeCount) ? ((4 + (state.typeCount * 32)) + ((state.typeCount - 1) * 2)) : 0))
  ellipsis(state.title, (width - badges))
  local(:left, "const u32", (((8 + width) - badges) + 4))
  for_loop(local(:i, "u32", 0), (i < 2), pre_inc(i)) do
    local(:actor, "void *", mem("void*", state.work, (292 + (4 * i))))
    if (i < state.typeCount)
      local(:position, "const short[2]", aggregate("const short[2]", cast("short", ((left + 16) + (i * 34))), 12))
      invoke(native("void(*)(void*,const short*)", 0x0204c23d, 0x0204c211), actor, position)
      local(:palette, "const u32", invoke(native("u32(*)(u32)", 0x0202d815, 0x0202d7e9), state.types[i]))
      invoke(native("void(*)(void*,u32,u32)", 0x0204c3a5, 0x0204c379), actor, palette, 1)
      assign(mem("volatile u32", state.work, (320 + (i * 8))), state.types[i])
      assign(mem("volatile u32", state.work, (324 + (i * 8))), 1)
    else
      assign(mem("volatile u32", state.work, (324 + (i * 8))), 0)
    end
    invoke(native("void(*)(void*,u32)", 0x0204c151, 0x0204c125), actor, ((i < state.typeCount) && truth((customRegions & 1))))
  end
end

signature :bankString, returns: "bool", args: { messages: "Messages &", bank: "u32", id: "u32", out: "u16 *", capacity: "u32" }, scope: "private"
def bankString(messages, bank, id, out, capacity)
  bank = messageBank(bank)
  out[0] = End
  local(:handle, "void *", messages.handle(bank, id))
  if (!truth(handle))
    return false
  end
  local(:text, "void *", message(handle, id))
  if truth(text)
    copyText(out, capacity, stringText(text))
    stringFree(text)
  end
  return (text != nil)
end

signature :privateString, returns: "bool", args: { messages: "Messages &", key: "InfoMessage", out: "u16 *", capacity: "u32" }, scope: "private"
def privateString(messages, key, out, capacity)
  local(:i, "const u32", cast("u32", key))
  local(:id, "const u16", learnsetInfoConfig.ids[i][0])
  local(:inverse, "const u16", learnsetInfoConfig.ids[i][1])
  if (((learnsetInfoConfig.version != 1) || (learnsetInfoConfig.count != InfoMessageCount)) || (!configured(id, inverse)))
    asciiText(out, capacity, "Info unavailable.")
    return false
  end
  if bankString(messages, 401, id, out, capacity)
    return true
  end
  asciiText(out, capacity, "Info unavailable.")
  return false
end

signature :number, returns: "void", args: { out: "u16 *", value: "u32" }, scope: "private"
def number(out, value)
  out[decimal(out, value)] = End
end

signature :speciesName, returns: "void", args: { messages: "Messages &", species: "u16", out: "u16 *", capacity: "u32" }, scope: "private"
def speciesName(messages, species, out, capacity)
  if (!bankString(messages, 90, species, out, capacity))
    asciiText(out, capacity, "#")
    number((out + 1), species)
  end
end

signature :requirement, returns: "void", args: { messages: "Messages &", e: "const Evolution &", out: "u16 *" }, scope: "private"
def requirement(messages, e, out)
  local(:format, "u16[192]")
  local(:parameter, "u16[64]")
  local(:second, "u16[16]")
  number(parameter, e.parameter)
  number(second, e.parameter)
  local(:bank, "u32", 0)
  case e.method
  when 6, 8, 17, 18, 19, 20
    bank = 64
  when 7, 22
    bank = 90
  when 21
    bank = 403
  end
  if (truth(bank) && (!bankString(messages, bank, e.parameter, parameter, 64)))
    number(parameter, e.parameter)
  end
  local(:key, "InfoMessage", enum_value("InfoMessage", "Unknown"))
  if ((e.method >= 1) && (e.method <= 31))
    key = cast("InfoMessage", ((cast("u32", enum_value("InfoMessage", "Method1")) + e.method) - 1))
  else
    number(parameter, e.method)
  end
  privateString(messages, key, format, 192)
  expandInfo(out, TextCapacity, format, parameter, second)
end

signature :loadIcon, returns: "bool", args: { icons: "Archive &", node: "const InfoNode &", gender: "u32", index: "u32" }, scope: "private"
def loadIcon(icons, node, gender, index)
  local(:member, "const u32", invoke(native("u32(*)(u32,u32,u32,u32)", 0x02020fc1, 0x02020f95), node.species, node.form, gender, 0))
  local(:pal, "const u32", invoke(native("u32(*)(u32,u32,u32,u32)", 0x02021061, 0x02021035), node.species, node.form, gender, 0))
  local(:data, "u8[1072]")
  local(:palette, "u8[256]")
  local(:length, "const u32", icons.member(member, data, size_of_expr(data), false))
  local(:palLength, "const u32", icons.member(0, palette, size_of_expr(palette), false))
  if ((((((length != 1072) || (read32(data) != 1313032018)) || (read32((data + 16)) != 1128808786)) || (read32((data + 40)) != 1024)) || (pal >= 3)) || (palLength < (40 + ((pal + 1) * 32))))
    return false
  end
  for_loop(local(:i, "u32", 0), (i < 1024), pre_inc(i)) do
    state.icons[index][i] = data[(48 + i)]
  end
  for_loop(local(:i, "u32", 0), (i < 16), pre_inc(i)) do
    state.palettes[index][i] = read16((((palette + 40) + (pal * 32)) + (i * 2)))
  end
  return true
end

signature :showBranch, returns: "void", args: { option: "u32" }, scope: "private"
def showBranch(option)
  local(:branch, "const auto&", state.branches[option])
  state.chain = branch.chain
  local(:used, "bool[3]", aggregate("bool[3]"))
  for_loop(local(:i, "u32", 0), (i < state.chain.count), pre_inc(i)) do
    state.iconSlots[i] = 3
    local(:node, "const auto&", branch.nodes[i])
    local(:gender, "const u32", ((i == state.chain.selected) ? state.gender : 0))
    for_loop(local(:s, "u32", 0), (s < 3), pre_inc(s)) do
      if ((((!used[s]) && (state.iconKeys[s].species == node.species)) && (state.iconKeys[s].form == node.form)) && (state.iconKeys[s].gender == gender))
        state.iconSlots[i] = s
        used[s] = true
        break
      end
    end
  end
  local(:icons, "Archive", construct("Archive"))
  local(:tried, "bool", false)
  local(:opened, "bool", false)
  for_loop(local(:i, "u32", 0), (i < state.chain.count), pre_inc(i)) do
    if (state.iconSlots[i] == 3)
      local(:slot, "u32", 0)
      while used[slot]
        pre_inc(slot)
      end
      used[slot] = true
      state.iconSlots[i] = slot
      if (!tried)
        tried = true
        opened = icons.open("a/0/0/7")
      end
      local(:node, "const auto&", branch.nodes[i])
      local(:gender, "const u16", ((i == state.chain.selected) ? state.gender : 0))
      state.iconKeys[slot] = aggregate("IconKey", node.species, node.form, gender)
      state.iconsValid[slot] = (opened && loadIcon(icons, node, gender, slot))
    end
  end
end

# Read species/form data and build the displayed evolution branch.
signature :load, returns: "void", args: { request: "Request *" }, scope: "private"
def load(request)
  state.partyCue[0] = End
  local(:count, "const u32", partyCount(request.party))
  if ((truth(count) && (count <= 6)) && (request.partySlot < count))
    local(:cue, "u16 *", state.partyCue)
    local(:n, "u32", 0)
    if (count > 1)
      cue[post_inc(n)] = cast("char", 60)
      cue[post_inc(n)] = cast("char", 32)
    end
    n = (n + decimal((cue + n), (request.partySlot + 1)))
    cue[post_inc(n)] = cast("char", 47)
    n = (n + decimal((cue + n), count))
    if (count > 1)
      cue[post_inc(n)] = cast("char", 32)
      cue[post_inc(n)] = cast("char", 62)
    end
    cue[n] = End
  end
  local(:personal, "Archive", construct("Archive"))
  local(:evolutions, "Archive", construct("Archive"))
  local(:messages, "Messages", construct("Messages"))
  local(:msgOk, "const bool", messages.open("a/0/0/2"))
  local(:identity, "const auto", viewIdentity(request))
  local(:species, "const u32", identity.species)
  local(:form, "const u32", identity.form)
  state.gender = (((species == pokemonGet(request.tutor.pokemon, 5)) && (form == pokemonGet(request.tutor.pokemon, 111))) ? pokemonGet(request.tutor.pokemon, 110) : 0)
  local(:name, "u16[64]")
  local(:format, "u16[128]")
  speciesName(messages, species, name, 64)
  copyText(state.selectedName, 64, name)
  for_loop(local(:i, "u32", 0), (name[i] != End), pre_inc(i)) do
    name[i] = infoUpper(name[i])
  end
  privateString(messages, enum_value("InfoMessage", "Title"), format, 128)
  expandInfo(state.title, 96, format, name, nil)
  for_loop(local(:i, "u32", 0), (i < 6), pre_inc(i)) do
    privateString(messages, cast("InfoMessage", (1 + i)), state.labels[i], 16)
    ellipsis(state.labels[i], 26)
  end
  privateString(messages, enum_value("InfoMessage", "EvolutionUnavailable"), state.status, 64)
  privateString(messages, enum_value("InfoMessage", "StatsUnavailable"), state.statsUnavailable, 64)
  privateString(messages, enum_value("InfoMessage", "AbilitiesUnavailable"), state.abilityNames[0], 64)
  if (((((!personal.open("a/0/1/6")) || (!truth(personal.count))) || (personal.count > MaxPersonal)) || (!truth(species))) || (species >= personal.count))
    return
  end
  if (state.graphCount != personal.count)
    release(state.graph)
    state.graph = nil
    state.graphCount = 0
    state.graphReady = false
  end
  if (!truth(state.graph))
    state.graph = cast("InfoNode *", alloc(Heap, (personal.count * size_of("InfoNode"))))
    if truth(state.graph)
      state.graphCount = personal.count
    end
  end
  local(:nodes, "InfoNode *", state.graph)
  if (!truth(nodes))
    return
  end
  local(:rebuild, "const bool", (!state.graphReady))
  local(:record, "u8[76]")
  if rebuild
    personal.buffer()
    for_loop(local(:i, "u32", 0), (i < personal.count), pre_inc(i)) do
      nodes[i] = aggregate("InfoNode")
    end
    for_loop(local(:i, "u32", 1), (i < personal.count), pre_inc(i)) do
      if (personal.member(i, record, PersonalRecordSize, false) == PersonalRecordSize)
        nodes[i].species = i
        nodes[i].valid = true
      end
    end
    for_loop(local(:i, "u32", 1), (i < personal.count), pre_inc(i)) do
      if (((!nodes[i].valid) || truth(nodes[i].form)) || (personal.member(i, record, PersonalRecordSize, false) != PersonalRecordSize))
        next
      end
      local(:first, "const u32", read16((record + 28)))
      local(:forms, "const u32", record[32])
      if (((((!truth(first)) || (forms < 2)) || (forms > 32)) || (first >= personal.count)) || ((forms - 1) > (personal.count - first)))
        next
      end
      for_loop(local(:f, "u32", 1), (f < forms), pre_inc(f)) do
        if (nodes[((first + f) - 1)].valid && (!truth(nodes[((first + f) - 1)].form)))
          nodes[((first + f) - 1)].species = i
          nodes[((first + f) - 1)].form = f
        end
      end
    end
  end
  local(:selected, "const u32", invoke(native("u32(*)(u32,u32)", 0x020204ad, 0x02020481), species, form))
  if ((selected >= personal.count) || (!nodes[selected].valid))
    return
  end
  local(:defaultParent, "u16", nodes[selected].parent)
  if (personal.member(selected, record, PersonalRecordSize, false) == PersonalRecordSize)
    local(:offsets, "const u8[6]", aggregate("const u8[6]", 0, 1, 2, 4, 5, 3))
    for_loop(local(:i, "u32", 0), (i < 6), pre_inc(i)) do
      state.stats[i] = record[offsets[i]]
    end
    state.statsValid = true
    if ((record[6] < 18) && (record[7] < 18))
      state.types[0] = record[6]
      state.types[1] = record[7]
      state.typeCount = ((record[6] == record[7]) ? 1 : 2)
    end
    state.abilities = infoAbilities((record + 24))
    if (!truth(state.abilities.count))
      privateString(messages, enum_value("InfoMessage", "NoAbilities"), state.abilityNames[0], 64)
    end
    for_loop(local(:i, "u32", 0), (i < state.abilities.count), pre_inc(i)) do
      local(:name, "u16 *", state.abilityNames[i])
      local(:id, "const u32", state.abilities.ids[i])
      if ((!bankString(messages, 487, id, name, 64)) || (name[0] == End))
        if ((!bankString(messages, 374, id, name, 64)) || (name[0] == End))
          asciiText(name, 64, "#")
          number((name + 1), id)
        end
      end
    end
  end
  personal.unbuffer()
  local(:options, "Evolutions", aggregate("Evolutions"))
  local(:incoming, "Evolutions", aggregate("Evolutions"))
  if (evolutions.open("a/0/1/9") && (evolutions.count <= MaxPersonal))
    if rebuild
      evolutions.buffer()
      for_loop(local(:source, "u32", 1), ((source < evolutions.count) && (source < personal.count)), pre_inc(source)) do
        if (!nodes[source].valid)
          next
        end
        local(:raw, "u8[48]")
        local(:length, "const u32", evolutions.member(source, raw, 48, false))
        local(:e, "Evolutions", parseEvolutions(raw, length, personal.count))
        if e.valid
          for_loop(local(:i, "u32", 0), (i < e.count), pre_inc(i)) do
            if (!nodes[e.entries[i].target].valid)
              e.valid = false
            end
          end
        end
        nodes[source].evolutionValid = e.valid
        if (!e.valid)
          next
        end
        for_loop(local(:i, "u32", 0), (i < e.count), pre_inc(i)) do
          local(:target, "const u16", e.entries[i].target)
          if (!truth(nodes[source].next))
            nodes[source].next = target
          end
          if (!truth(nodes[target].parent))
            nodes[target].parent = source
          end
        end
      end
      state.graphReady = true
    end
    record("Recent", { id: "u16", data: "Evolutions" })
    local(:recent, "struct Recent[4]", aggregate("struct Recent[4]"))
    local(:cursor, "u32", 0)
    local(:read, "auto", callback(returns: "Evolutions", args: { source: "u16" }) do
  for_loop(local(:i, "u32", 0), (i < 4), pre_inc(i)) do
    if (recent[i].id == source)
      return recent[i].data
    end
  end
  local(:raw, "u8[48]")
  local(:length, "const u32", evolutions.member(source, raw, 48, false))
  local(:e, "auto", parseEvolutions(raw, length, personal.count))
  if e.valid
    for_loop(local(:i, "u32", 0), (i < e.count), pre_inc(i)) do
      if (!nodes[e.entries[i].target].valid)
        e.valid = false
      end
    end
  end
  recent[cursor] = aggregate("Recent", source, e)
  cursor = ((cursor + 1) & 3)
  return e
end)
    options = invoke(read, cast("u16", selected))
    defaultParent = nodes[selected].parent
    local(:hint, "const auto", request.view.parent)
    if (truth(hint.species) && (hint.species < personal.count))
      local(:parent, "const u32", invoke(native("u32(*)(u32,u32)", 0x020204ad, 0x02020481), hint.species, hint.form))
      if ((parent < personal.count) && nodes[parent].valid)
        local(:targets, "u16[8]")
        local(:n, "const u32", familyTargets(nodes, personal.count, invoke(read, parent), targets))
        for_loop(local(:i, "u32", 0), (i < n), pre_inc(i)) do
          if sameNode(nodes, targets[i], selected)
            nodes[selected].parent = parent
          end
        end
      end
    end
    for_loop(local(:direction, "u32", 0), (direction < 2), pre_inc(direction)) do
      local(:step, "const auto", familyStep(nodes, personal.count, cast("u16", selected), (direction != 0), read))
      if truth(step.target)
        local(:node, "const auto&", nodes[step.target])
        state.navigation[direction].identity = aggregate("ViewIdentity", node.species, node.form)
        if ((truth(step.parent) && (step.parent < personal.count)) && nodes[step.parent].valid)
          local(:parent, "const auto&", nodes[step.parent])
          state.navigation[direction].parent = aggregate("ViewIdentity", parent.species, parent.form)
        end
      end
    end
    local(:parent, "const u16", nodes[selected].parent)
    if (((options.valid && (!truth(options.count))) && truth(parent)) && nodes[parent].evolutionValid)
      local(:e, "const auto", invoke(read, parent))
      if e.valid
        incoming.valid = true
        for_loop(local(:i, "u32", 0), (i < e.count), pre_inc(i)) do
          if (nodes[e.entries[i].target].valid && sameNode(nodes, e.entries[i].target, selected))
            incoming.entries[0] = e.entries[i]
            incoming.count = 1
          end
        end
      end
    end
    evolutions.unbuffer()
  end
  local(:branches, "const u32", ((options.valid && truth(options.count)) ? options.count : 1))
  for_loop(local(:b, "u32", 0), (b < branches), pre_inc(b)) do
    local(:branch, "auto&", state.branches[b])
    branch.chain = infoChain(nodes, personal.count, selected, ((options.valid && truth(options.count)) ? options.entries[b].target : End))
    for_loop(local(:i, "u32", 0), (i < branch.chain.count), pre_inc(i)) do
      branch.nodes[i] = nodes[branch.chain.ids[i]]
    end
  end
  showBranch(0)
  state.evolutionValid = (options.valid && msgOk)
  if (state.evolutionValid && (!truth(options.count)))
    privateString(messages, (truth(nodes[selected].parent) ? enum_value("InfoMessage", "NoFurtherEvolution") : enum_value("InfoMessage", "NoEvolution")), state.status, 64)
  end
  local(:fromParent, "const bool", (incoming.valid && truth(incoming.count)))
  local(:details, "const auto&", (fromParent ? incoming : options))
  if state.evolutionValid
    for_loop(local(:i, "u32", 0), (i < details.count), pre_inc(i)) do
      if fromParent
        local(:detail, "u16[256]")
        local(:source, "u16[64]")
        local(:format, "u16[64]")
        requirement(messages, details.entries[i], detail)
        speciesName(messages, nodes[nodes[selected].parent].species, source, 64)
        privateString(messages, enum_value("InfoMessage", "FromPredecessor"), format, 64)
        expandInfo(state.requirements[i], TextCapacity, format, source, detail)
      else
        requirement(messages, details.entries[i], state.requirements[i])
        speciesName(messages, nodes[details.entries[i].target].species, state.targets[i], 64)
      end
      local(:line, "u16[128]")
      local(:offset, "u32", 0)
      do_while((state.requirements[i][offset] != End)) do
        if (state.pageCount >= 128)
          break
        end
        state.pages[post_inc(state.pageCount)] = aggregate("Page", cast("u16", offset), cast("u8", i), fromParent)
        for_loop(local(:n, "u32", 0), (n < 2), pre_inc(n)) do
          offset = wrapInfo(state.requirements[i], offset, line, 128, 240, measure)
        end
      end
    end
  end
  nodes[selected].parent = defaultParent
end

signature :rgb, returns: "u16", args: { r: "u32", g: "u32", b: "u32" }, scope: "private", qualifiers: ["constexpr"]
def rgb(r, g, b)
  return (((r >> 3) | ((g >> 3) << 5)) | ((b >> 3) << 10))
end

global :colors, { type: "constexpr const u16[16]", scope: "private" }, aggregate("const u16[16]", rgb(48, 50, 65), rgb(48, 50, 65), rgb(32, 33, 43), rgb(24, 27, 31), rgb(82, 89, 100), rgb(58, 71, 80), rgb(64, 188, 180), rgb(142, 235, 219), rgb(180, 184, 192), rgb(218, 218, 222), rgb(238, 175, 62), rgb(255, 219, 149), rgb(205, 158, 247), 0, 0, rgb(239, 244, 240))

global :HiddenAbilityColor, { type: "constexpr const u16", scope: "private" }, rgb(120, 72, 160)

global :InsetInk, { type: "constexpr const u32", scope: "private" }, 13

global :InsetTextInk, { type: "constexpr const u32", scope: "private" }, ((6 << 10) | (14 << 5))

global :HiddenAbilityInk, { type: "constexpr const u32", scope: "private" }, ((12 << 10) | (14 << 5))

signature :iconX, returns: "u32", args: { index: "u32" }, scope: "private"
def iconX(index)
  return (((state.chain.count == 3) ? 120 : ((state.chain.count == 2) ? 144 : 168)) + (index * 48))
end

global :CardTop, { type: "constexpr const u32", scope: "private" }, 46

global :CardBottom, { type: "constexpr const u32", scope: "private" }, 81

global :IconY, { type: "constexpr const u32", scope: "private" }, 48

global :StatY, { type: "constexpr const u32", scope: "private" }, 41

global :StatStep, { type: "constexpr const u32", scope: "private" }, 15

global :AbilityY, { type: "constexpr const u32", scope: "private" }, 84

global :UpperBottom, { type: "constexpr const u32", scope: "private" }, 131

global :GutterY, { type: "constexpr const u32", scope: "private" }, 132

global :EvolutionY, { type: "constexpr const u32", scope: "private" }, 140

global :StatInk, { type: "constexpr const u32", scope: "private" }, InsetTextInk

global :IconFrameTicks, { type: "constexpr const u32", scope: "private" }, 8

signature :drawIconPixels, returns: "bool", args: { data: "u8 *" }, scope: "private"
def drawIconPixels(data)
  local(:changed, "bool", false)
  for_loop(local(:i, "u32", 0), (i < state.chain.count), pre_inc(i)) do
    local(:slot, "const u32", state.iconSlots[i])
    local(:x, "const u32", iconX(i))
    if (!state.iconsValid[slot])
      next
    end
    local(:frame, "const u8 *", (state.icons[slot] + ((i == state.chain.selected) ? (state.iconFrame * 512) : 0)))
    for_loop(local(:t, "u32", 0), (t < 16), pre_inc(t)) do
      local(:tx, "const u32", (t % 4))
      local(:ty, "const u32", (t / 4))
      for_loop(local(:b, "u32", 0), (b < 32), pre_inc(b)) do
        data[(((((((IconY / 8) + ty) * 32) + (x / 8)) + tx) * 32) + b)] = frame[((t * 32) + b)]
      end
    end
    changed = true
  end
  return changed
end

# Animate cached icon poses without allocations or archive reads.
signature :animateIcons, returns: "void", args: {  }, scope: "private"
def animateIcons()
  if (!truth((customRegions & 4)))
    return
  end
  if (pre_inc(state.iconTicks) < IconFrameTicks)
    return
  end
  state.iconTicks = 0
  state.iconFrame = (state.iconFrame ^ 1)
  local(:data, "u8 *", pixels())
  if (truth(data) && drawIconPixels(data))
    invoke(native("void(*)(void*)", 0x02048271, 0x02048245), mem("void*", state.work, 56))
  end
end

signature :background, returns: "void", args: { data: "u8 *" }, scope: "private"
def background(data)
  invoke(native("void(*)(u32,u32)", 0x02044cc5, 0x02044c99), 3, 0)
  local(:palette, "volatile u16 *", reinterpret("volatile u16 *", 83886080))
  local(:subBg, "const volatile u16 *", reinterpret("const volatile u16 *", 83887104))
  local(:panelColor, "const u16", subBg[17])
  palette[0] = panelColor
  for_loop(local(:i, "u32", 0), (i < 16), pre_inc(i)) do
    palette[((14 * 16) + i)] = colors[i]
  end
  each_native(TutorBackgroundColors, :color, "const auto&") do
    palette[((14 * 16) + color.index)] = color.value
  end
  for_loop(local(:i, "u32", 0), (i < 16), pre_inc(i)) do
    palette[((9 * 16) + i)] = palette[((14 * 16) + i)]
  end
  palette[((9 * 16) + 7)] = rgb(32, 120, 120)
  palette[((9 * 16) + 9)] = panelColor
  palette[((9 * 16) + InsetInk)] = panelColor
  palette[((9 * 16) + 12)] = HiddenAbilityColor
  palette[((9 * 16) + 6)] = palette[((15 * 16) + 1)]
  palette[((9 * 16) + 14)] = palette[((15 * 16) + 2)]
  palette[((9 * 16) + 2)] = subBg[19]
  palette[((9 * 16) + 5)] = subBg[21]
  for_loop(local(:i, "u32", 0), (i < 16), pre_inc(i)) do
    palette[((13 * 16) + i)] = palette[((14 * 16) + i)]
  end
  palette[((13 * 16) + 1)] = rgb(48, 80, 80)
  palette[((13 * 16) + 5)] = rgb(56, 56, 64)
  palette[((13 * 16) + 9)] = panelColor
  palette[((13 * 16) + InsetInk)] = panelColor
  palette[((13 * 16) + 12)] = HiddenAbilityColor
  palette[((13 * 16) + 6)] = palette[((15 * 16) + 1)]
  palette[((13 * 16) + 14)] = palette[((15 * 16) + 2)]
  for_loop(local(:i, "u32", 0), (i < 16), pre_inc(i)) do
    palette[((8 * 16) + i)] = palette[((13 * 16) + i)]
  end
  palette[((8 * 16) + 2)] = subBg[19]
  palette[((8 * 16) + 5)] = subBg[21]
  palette[((8 * 16) + 7)] = palette[((9 * 16) + 7)]
  infoRect(data, 0, 0, 256, 192, 1)
  each_native(TutorBackgroundRuns, :row, "const auto&") do
    if (row.y < 40)
      infoRect(data, 0, row.y, 256, ((row.height < (40 - row.y)) ? row.height : (40 - row.y)), row.color)
    end
  end
  for_loop(local(:y, "u32", 40), (y <= UpperBottom), pre_inc(y)) do
    infoRect(data, 0, y, ((y < 52) ? ((100 + y) - 40) : 112), 1, 9)
  end
  for_loop(local(:y, "u32", 40), (y <= UpperBottom), pre_inc(y)) do
    local(:cut, "const u32", ((y < 44) ? (44 - y) : ((y > (UpperBottom - 4)) ? (y - (UpperBottom - 4)) : 0)))
    local(:left, "const u32", (112 + cut))
    local(:right, "const u32", (255 - cut))
    infoRect(data, left, y, ((right - left) + 1), 1, (((y == 40) || (y == UpperBottom)) ? 4 : InsetInk))
    infoPixel(data, left, y, 4)
    infoPixel(data, right, y, 4)
  end
  for_loop(local(:y, "u32", 41), (y < UpperBottom), pre_inc(y)) do
    local(:cut, "const u32", ((y < 44) ? (44 - y) : ((y > (UpperBottom - 4)) ? (y - (UpperBottom - 4)) : 0)))
    local(:left, "const u32", (112 + cut))
    local(:right, "const u32", (255 - cut))
    infoRect(data, (left + 1), y, 3, 1, 5)
    infoPixel(data, (left + 4), y, 2)
    if ((y == (AbilityY + 16)) || (y == (AbilityY + 32)))
      infoRect(data, (left + 4), y, ((right - left) - 4), 1, 2)
    end
  end
  infoRect(data, 0, GutterY, 256, 4, 1)
  infoRect(data, 0, 140, 256, 52, 5)
  infoRect(data, 0, 136, 25, 1, 3)
  for_loop(local(:d, "u32", 1), (d <= 3), pre_inc(d)) do
    infoRect(data, 0, (136 + d), (24 + d), 1, 3)
    infoPixel(data, (24 + d), (136 + d), 3)
    infoPixel(data, (16 + d), (136 + d), 7)
    infoPixel(data, (20 + d), (136 + d), 7)
  end
  infoRect(data, 27, 139, 229, 1, 3)
end

signature :paletteMap, returns: "u16 *", args: {  }, scope: "private"
def paletteMap()
  local(:map, "u16 *", invoke(native("u16*(*)(u32)", 0x02045841, 0x02045815), 2))
  if truth(map)
    for_loop(local(:y, "u32", 5), (y < 24), pre_inc(y)) do
      for_loop(local(:x, "u32", 0), (x < 32), pre_inc(x)) do
        map[((y * 32) + x)] = cast("u16", ((map[((y * 32) + x)] & 4095) | (((((x >= 14) && (y >= 10)) && (y < 17)) ? 8 : ((y < 16) ? 9 : 13)) << 12)))
      end
    end
  end
  return map
end

signature :customLoad, returns: "void", args: { request: "Request *" }, scope: "private"
def customLoad(request)
  customRegions = 63
  if (request.reserved != 20567)
    return
  end
  local(:arc, "Archive", construct("Archive"))
  local(:program, "u8[32]")
  if ((((((((!arc.open("pokeweb/custom-ui.narc")) || (arc.member(2, program, 32, false) != 32)) || (read32(program) != 1314215760)) || (read16((program + 4)) != 1)) || (read16((program + 6)) != 1)) || (read32((program + 8)) != 32)) || (read32((program + 12)) > 63)) || (!truth((read32((program + 12)) & 32))))
    return
  end
  customRegions = read32((program + 12))
end

# Draw the upper panel into the native bitmap and palette.
signature :render, returns: "void", args: {  }, scope: "private"
def render()
  local(:data, "u8 *", pixels())
  if (!truth(data))
    return
  end
  background(data)
  local(:palette, "volatile u16 *", reinterpret("volatile u16 *", 83886080))
  if truth((customRegions & 1))
    put(state.title, 8, 4, 15424)
  end
  if (truth((customRegions & 1)) && (state.partyCue[0] != End))
    put(state.partyCue, (248 - cast("int", measure(state.partyCue))), 4, ((7 << 10) | (3 << 5)))
  end
  local(:text, "u16[128]")
  if (truth((customRegions & 2)) && state.statsValid)
    for_loop(local(:i, "u32", 0), (i < 6), pre_inc(i)) do
      local(:y, "const u32", (StatY + (StatStep * i)))
      put(state.labels[i], 6, y, StatInk)
      number(text, state.stats[i])
      put(text, (52 - cast("int", measure(text))), y, StatInk)
      infoRect(data, 57, (y + 4), 46, 8, 8)
      infoRect(data, 57, (y + 4), statBar(state.stats[i], 46), 8, 10)
      infoRect(data, 57, (y + 4), statBar(state.stats[i], 46), 2, 11)
    end
  else
    if truth((customRegions & 2))
      copyText(text, 128, state.statsUnavailable)
      ellipsis(text, 96)
      put(text, 6, 64, StatInk)
    end
  end
  for_loop(local(:i, "u32", 0), (truth((customRegions & 4)) && (i < state.chain.count)), pre_inc(i)) do
    local(:x, "const u32", iconX(i))
    local(:slot, "const u32", state.iconSlots[i])
    if (i == state.chain.selected)
      infoRect(data, (x - 2), CardTop, 36, ((CardBottom - CardTop) + 1), 7)
      infoRect(data, (x - 1), (CardTop + 1), 34, ((CardBottom - CardTop) - 1), InsetInk)
    end
    if state.iconsValid[slot]
      for_loop(local(:t, "u32", 0), (t < 16), pre_inc(t)) do
        palette[(((10 + i) * 16) + t)] = state.palettes[slot][t]
      end
    else
      asciiText(text, 128, "?")
      put(text, (x + 12), (IconY + 8), InsetTextInk)
    end
    if ((i + 1) < state.chain.count)
      infoRect(data, (x + 35), (IconY + 15), 10, 2, 4)
      for_loop(local(:d, "u32", 1), (d < 4), pre_inc(d)) do
        infoPixel(data, ((x + 44) - d), ((IconY + 15) - d), 4)
        infoPixel(data, ((x + 44) - d), ((IconY + 16) + d), 4)
      end
    end
  end
  if truth((customRegions & 4))
    drawIconPixels(data)
  end
  for_loop(local(:dot, "u32", 0), (truth((customRegions & 4)) && (dot < 3)), pre_inc(dot)) do
    if state.chain.before
      infoPixel(data, ((iconX(0) - 7) + (dot * 2)), (IconY + 15), 4)
    end
    if state.chain.after
      infoPixel(data, ((iconX((state.chain.count - 1)) + 34) + (dot * 2)), (IconY + 15), 4)
    end
  end
  local(:count, "const u32", (truth(state.abilities.count) ? state.abilities.count : 1))
  for_loop(local(:i, "u32", 0), (truth((customRegions & 8)) && (i < count)), pre_inc(i)) do
    copyText(text, 128, state.abilityNames[i])
    if truth(state.abilities.count)
      infoTitleCase(text)
    end
    ellipsis(text, 132)
    put(text, 120, (AbilityY + (16 * i)), (state.abilities.hidden[i] ? HiddenAbilityInk : InsetTextInk))
  end
  if (truth((customRegions & 16)) && truth(state.pageCount))
    local(:headerWidth, "u32", 240)
    if (state.pageCount > 1)
      asciiText(text, 128, "A ")
      local(:n, "u32", 2)
      n = (n + decimal((text + n), (state.page + 1)))
      text[post_inc(n)] = cast("char", 47)
      n = (n + decimal((text + n), state.pageCount))
      text[n] = End
      local(:width, "const u32", measure(text))
      put(text, (248 - cast("int", width)), EvolutionY, 15424)
      headerWidth = (headerWidth - (width + 8))
    end
    local(:p, "const Page &", state.pages[state.page])
    if p.incoming
      copyText(text, 128, state.status)
    else
      local(:a, "u16[64]")
      local(:b, "u16[64]")
      copyText(a, 64, state.selectedName)
      copyText(b, 64, state.targets[p.option])
      ellipsis(a, ((headerWidth - 20) / 2))
      ellipsis(b, ((headerWidth - 20) / 2))
      local(:n, "u32", copyText(text, 128, a))
      text[post_inc(n)] = cast("char", 32)
      text[post_inc(n)] = 8594
      text[post_inc(n)] = cast("char", 32)
      copyText((text + n), (128 - n), b)
    end
    ellipsis(text, headerWidth)
    put(text, 8, EvolutionY, 15424)
    local(:offset, "u32", p.offset)
    for_loop(local(:row, "u32", 0), (row < 2), pre_inc(row)) do
      offset = wrapInfo(state.requirements[p.option], offset, text, 128, 240, measure)
      put(text, 8, ((EvolutionY + 16) + (row * 16)), 15424)
    end
  else
    if truth((customRegions & 16))
      local(:offset, "u32", 0)
      for_loop(local(:row, "u32", 0), (row < 3), pre_inc(row)) do
        offset = wrapInfo(state.status, offset, text, 128, 240, measure)
        put(text, 8, (EvolutionY + (row * 16)), 15424)
      end
    end
  end
  local(:window, "void *", mem("void*", state.work, 56))
  invoke(native("void(*)(void*)", 0x02048271, 0x02048245), window)
  invoke(native("void(*)(void*)", 0x02048299, 0x0204826d), window)
  local(:map, "u16 *", paletteMap())
  if truth(map)
    for_loop(local(:i, "u32", 0), (truth((customRegions & 4)) && (i < state.chain.count)), pre_inc(i)) do
      if state.iconsValid[state.iconSlots[i]]
        for_loop(local(:y, "u32", (IconY / 8)), (y < ((IconY / 8) + 4)), pre_inc(y)) do
          for_loop(local(:x, "u32", (iconX(i) / 8)), (x < ((iconX(i) / 8) + 4)), pre_inc(x)) do
            map[((y * 32) + x)] = cast("u16", ((map[((y * 32) + x)] & 4095) | ((10 + i) << 12)))
          end
        end
      end
    end
  end
  invoke(native("void(*)(u32)", 0x02045ba9, 0x02045b7d), 2)
end

signature :infoInit, returns: "void", args: { work: "void *", request: "Request *" }, scope: "global"
def infoInit(work, request)
  infoEnd()
  for_loop(local(:offset, "u32", 292), (offset <= 308), assign(offset, (offset + 4))) do
    invoke(native("void(*)(void*,u32)", 0x0204c151, 0x0204c125), mem("void*", work, offset), 0)
  end
  state = cast("InfoState *", alloc(Heap, size_of("InfoState")))
  if (!truth(state))
    local(:window, "void *", mem("void*", work, 56))
    local(:bitmap, "void *", invoke(native("void*(*)(void*)", 0x02048521, 0x020484f5), window))
    local(:data, "u8 *", invoke(native("u8*(*)(void*)", 0x02046f21, 0x02046ef5), bitmap))
    if truth(data)
      background(data)
    end
    local(:text, "u16[32]")
    asciiText(text, 32, "Info unavailable.")
    local(:buffer, "void *", mem("void*", work, 76))
    stringSet(buffer, text)
    invoke(native("void(*)(void*,int,int,void*,void*,u32)", 0x02021d55, 0x02021d29), bitmap, 8, StatY, buffer, mem("void*", work, 96), StatInk)
    invoke(native("void(*)(void*)", 0x02048271, 0x02048245), window)
    invoke(native("void(*)(void*)", 0x02048299, 0x0204826d), window)
    paletteMap()
    invoke(native("void(*)(u32)", 0x02045ba9, 0x02045b7d), 2)
    return
  end
  assign(deref(state), aggregate("InfoState"))
  state.work = work
  load(request)
  customLoad(request)
  headerTypes()
  render()
end

signature :infoInput, returns: "void", args: { work: "void *" }, scope: "global"
def infoInput(work)
  if ((!truth(state)) || (state.work != work))
    return
  end
  animateIcons()
  if (state.pageCount < 2)
    return
  end
  local(:keys, "const u32", invoke(native("u32(*)()", 0x0203df29, 0x0203defd)))
  if ((keys & 3) == 1)
    state.page = (((state.page + 1) == state.pageCount) ? 0 : (state.page + 1))
  else
    return
  end
  render()
end

signature :infoReload, returns: "void", args: { work: "void *", request: "Request *" }, scope: "global"
def infoReload(work, request)
  if ((!truth(state)) || (state.work != work))
    return
  end
  assign(cast("InfoView &", deref(state)), aggregate("InfoView"))
  state.work = work
  load(request)
  headerTypes()
  render()
end

signature :infoNavigate, returns: "bool", args: { work: "void *", request: "Request *", forward: "bool" }, scope: "global"
def infoNavigate(work, request, forward)
  if (((!truth(state)) || (state.work != work)) || (!truth(request)))
    return false
  end
  local(:next_value, "const auto&", state.navigation[(forward ? 1 : 0)])
  if (!truth(next_value.identity.species))
    return false
  end
  request.nextView = next_value
  request.nextSlot = BrowseFamily
  return true
end

# Release graph and icon state at the end of every viewer session.
signature :infoEnd, returns: "void", args: {  }, scope: "global"
def infoEnd()
  customRegions = 63
  local(:old, "InfoState *", state)
  state = nil
  if truth(old)
    release(old.graph)
  end
  release(old)
end

signature :LearnsetWindow, returns: "void *", args: { frame: "u32", x: "u32", y: "u32", width: "u32", height: "u32", palette: "u32", direction: "u32" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetWindow(frame, x, y, width, height, palette, direction)
  if ((LearnsetIsActive() && (frame == 2)) && (width > 1))
    if (y == 0)
      x = 0
      y = 0
      width = 32
      height = 24
      palette = 14
    else
      x = 0
      y = 24
      width = 1
      height = 1
    end
  end
  return invoke(native("void*(*)(u32,u32,u32,u32,u32,u32,u32)", 0x020480ed, 0x020480c1), frame, x, y, width, height, palette, direction)
end
