# Parsed typed Ruby source; edit this file, then rebuild.

global :active, { type: "Request *", scope: "private" }

signature :ours, returns: "bool", args: { work: "void *" }, scope: "private"
def ours(work)
  return ((truth(active) && truth(work)) && (mem("void*", work, 0) == address_of(active.tutor)))
end

signature :bitmap, returns: "void *", args: { window: "void *" }, scope: "private"
def bitmap(window)
  return invoke(native("void*(*)(void*)", 0x02048521, 0x020484f5), window)
end

signature :flush, returns: "void", args: { window: "void *" }, scope: "private"
def flush(window)
  invoke(native("void(*)(void*)", 0x02048271, 0x02048245), window)
  invoke(native("void(*)(void*)", 0x02048299, 0x0204826d), window)
  local(:frame, "const u32", invoke(native("u32(*)(void*)", 0x02048501, 0x020484d5), window))
  invoke(native("void(*)(u32)", 0x02045ba9, 0x02045b7d), frame)
end

signature :draw, returns: "void", args: { work: "void *", window: "u32", x: "int", y: "int", text: "void *", color: "u32" }, scope: "private"
def draw(work, window, x, y, text, color)
  invoke(native("void(*)(void*,int,int,void*,void*,u32)", 0x02021d55, 0x02021d29), bitmap(mem("void*", work, (4 + (window * 4)))), x, y, text, mem("void*", work, 96), color)
end

signature :visible, returns: "void", args: { sprite: "void *", enabled: "bool" }, scope: "private"
def visible(sprite, enabled)
  invoke(native("void(*)(void*,u32)", 0x0204c151, 0x0204c125), sprite, enabled)
end

signature :freeList, returns: "void", args: { lines: "void *" }, scope: "private"
def freeList(lines)
  invoke(native("void(*)(void*)", 0x02024fd9, 0x02024fad), lines)
end

global :MoveListSound, { type: "constexpr const u32", scope: "private" }, 1356

global :SummaryPageSound, { type: "constexpr const u32", scope: "private" }, 1637

signature :navigationSound, returns: "void", args: { sound: "u32" }, scope: "private"
def navigationSound(sound)
  invoke(native("void(*)(u32)", 0x02006255, 0x02006255), sound)
end

# Build the replacement native list before committing a family change.
signature :refreshFamily, returns: "bool", args: { work: "void *" }, scope: "private"
def refreshFamily(work)
  local(:next_value, "Request", deref(active))
  next_value.view = next_value.nextView
  next_value.nextView = aggregate("ViewSelection")
  next_value.nextSlot = 255
  active.nextView = aggregate("ViewSelection")
  active.nextSlot = 255
  if (!truth(next_value.view.identity.species))
    return false
  end
  buildList(address_of(next_value), 79)
  next_value.tutor.cursor = assign(next_value.tutor.scroll, 0)
  next_value.tutor.page = 0
  local(:count, "const u32", (truth(next_value.list.count) ? next_value.list.count : 1))
  for_loop(local(:i, "u32", 0), (i < (MaxEntries + 1)), pre_inc(i)) do
    next_value.ids[i] = End
  end
  for_loop(local(:i, "u32", 0), (i < next_value.list.count), pre_inc(i)) do
    next_value.ids[i] = next_value.list.entries[i].moveId
  end
  if (!truth(next_value.list.count))
    next_value.ids[0] = 1
  end
  local(:lines, "auto*", invoke(native("MenuLine*(*)(u32,u32)", 0x02024f8d, 0x02024f61), count, 79))
  if (!truth(lines))
    return false
  end
  local(:names, "void *", messageOpen(403, 79))
  if (!truth(names))
    freeList(lines)
    return false
  end
  for_loop(local(:i, "u32", 0), (i < count), pre_inc(i)) do
    lines[i] = aggregate("MenuLine", message(names, next_value.ids[i]), next_value.ids[i])
    if (!truth(lines[i].text))
      messageClose(names)
      freeList(lines)
      return false
    end
  end
  messageClose(names)
  local(:old, "void *", mem("void*", work, 88))
  assign(deref(active), next_value)
  assign(mem("void*", work, 88), lines)
  assign(mem("u8", work, 440), count)
  assign(mem("u8", work, 443), assign(mem("u8", work, 444), assign(mem("u8", work, 445), 0)))
  assign(mem("u16", work, 460), 0)
  invoke(native("void(*)(void*,u32)", 0x0202ba91, 0x0202ba65), mem("void*", work, 456), 0)
  freeList(old)
  infoReload(work, active)
  invoke(native("void(*)(void*)", 0x0219a8ed, 0x0219a8ad), work)
  LearnsetDetails(work, active.ids[0])
  invoke(native("void(*)(void*)", 0x0219b77d, 0x0219b73d), work)
  invoke(native("void(*)(void*)", 0x0219b859, 0x0219b819), work)
  invoke(native("void(*)(void*,u32,u32)", 0x0219b2f5, 0x0219b2b5), work, 0, 3)
  visible(mem("void*", work, 268), (active.list.count != 0))
  return true
end

signature :LearnsetIsActive, returns: "bool", args: {  }, scope: "global", qualifiers: ["extern_c"]
def LearnsetIsActive()
  return (active != nil)
end

# Accept only the versioned viewer request ABI.
signature :LearnsetViewerInit, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetViewerInit(proc, seq, data, work)
  infoEnd()
  active = 0
  local(:tutor, "TutorData *", cast("TutorData *", data))
  if (truth(tutor) && (tutor.mode == 254))
    local(:request, "Request *", cast("Request *", data))
    if (((((((request.magic != RequestMagic) || (request.version != RequestVersion)) || (request.size != size_of("Request"))) || (request.list.count > MaxEntries)) || (request.tutor.moves != request.ids)) || (!truth(request.party))) || (request.partySlot >= 6))
      return 1
    end
    active = request
    tutor.mode = 1
    request.viewerStarted = 1
  end
  return invoke(native("Proc", 0x02199901, 0x021998c1), proc, seq, data, work)
end

# Preserve native transitions; route party and family navigation.
signature :LearnsetViewerMain, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetViewerMain(proc, seq, data, work)
  if ours(work)
    if (deref(seq) == 14)
      assign(deref(seq), 8)
    end
    if (((((deref(seq) != 0) && (deref(seq) != 1)) && (deref(seq) != 8)) && (deref(seq) != 9)) && (deref(seq) != 13))
      assign(deref(seq), 1)
    end
    if (!truth(active.list.count))
      visible(mem("void*", work, 268), false)
    end
    if (deref(seq) == 1)
      local(:keys, "const u32", invoke(native("u32(*)()", 0x0203df29, 0x0203defd)))
      if ((!truth((keys & 3))) && (((keys & 48) == 32) || ((keys & 48) == 16)))
        local(:slot, "const u32", nextPartySlot(active.partySlot, partyCount(active.party), ((keys & 16) != 0), callback(returns: "bool", args: { i: "u32" }) do
  return viewable(partyPokemon(active.party, i))
end))
        if (slot == active.partySlot)
          return 0
        end
        active.nextSlot = slot
        navigationSound(SummaryPageSound)
        assign(deref(seq), 8)
      else
        if (((!truth((keys & 3))) && (((keys & 768) == 256) || ((keys & 768) == 512))) && infoNavigate(work, active, ((keys & 256) != 0)))
          if refreshFamily(work)
            navigationSound(MoveListSound)
          end
          return 0
        else
          infoInput(work)
        end
      end
    end
  end
  return invoke(native("Proc", 0x02199975, 0x02199935), proc, seq, data, work)
end

# Release viewer-only state when the tutor application exits.
signature :LearnsetViewerEnd, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetViewerEnd(proc, seq, data, work)
  infoEnd()
  local(:result, "const u32", invoke(native("Proc", 0x02199a51, 0x02199a11), proc, seq, data, work))
  if (truth(active) && (data == active))
    active.viewerStarted = 0
  end
  active = 0
  return result
end

signature :LearnsetDrawLine, returns: "void", args: { work: "void *", scroll: "u8", pos: "u8" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetDrawLine(work, scroll, pos)
  if (!ours(work))
    invoke(native("void(*)(void*,u8,u8)", 0x0219a7f1, 0x0219a7b1), work, scroll, pos)
    return
  end
  local(:index, "const u32", (cast("u32", scroll) + pos))
  if ((index >= active.list.count) || (pos >= 4))
    return
  end
  local(:lines, "MenuLine *", mem("MenuLine*", work, 88))
  local(:buffer, "void *", mem("void*", work, 76))
  local(:name, "const u16 *", stringText(lines[index].text))
  local(:text, "u16[96]")
  local(:nameInset, "const u32", 2)
  label(text, 96, active.list.entries[index].level, name, (108 - nameInset), callback(returns: "unsigned int", args: { candidate: "const u16 *" }) do
  stringSet(buffer, candidate)
  return invoke(native("u32(*)(void*,void*,u32)", 0x020228b5, 0x02022889), buffer, mem("void*", work, 96), 0)
end)
  stringSet(buffer, text)
  draw(work, 11, nameInset, (pos * 24), buffer, 15424)
  text[0] = cast("char", 80)
  text[1] = cast("char", 80)
  text[2] = cast("char", 32)
  local(:pp, "const u32", invoke(native("u32(*)(u32,u32)", 0x020216dd, 0x020216b1), active.list.entries[index].moveId, 0))
  text[(3 + decimal((text + 3), pp))] = End
  stringSet(buffer, text)
  draw(work, 11, 120, (pos * 24), buffer, 1088)
  flush(mem("void*", work, 48))
end

signature :LearnsetConfirm, returns: "int", args: { work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetConfirm(work)
  if ours(work)
    return 1
  end
  return invoke(native("int(*)(void*)", 0x0219b995, 0x0219b955), work)
end

signature :LearnsetEnterButton, returns: "void", args: { work: "void *", flag: "u32" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetEnterButton(work, flag)
  invoke(native("void(*)(void*,u32)", 0x0219b6c9, 0x0219b689), work, (ours(work) ? 0 : flag))
end

signature :LearnsetDetails, returns: "void", args: { work: "void *", move: "u32" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetDetails(work, move)
  if (ours(work) && (!truth(active.list.count)))
    move = cast("unsigned int", 4294967294)
  end
  invoke(native("void(*)(void*,u32)", 0x0219a9d9, 0x0219a999), work, move)
  if ((!ours(work)) || truth(active.list.count))
    return
  end
  local(:empty, "const bool", (active.list.status == enum_value("Status", "Empty")))
  local(:id, "const u16", (empty ? learnsetConfig.empty : learnsetConfig.error))
  local(:inverse, "const u16", (empty ? learnsetConfig.emptyXor : learnsetConfig.errorXor))
  if (!configured(id, inverse))
    return
  end
  local(:text, "void *", message(mem("void*", work, 68), id))
  if truth(text)
    draw(work, 6, 0, 0, text, 1088)
    flush(mem("void*", work, 28))
    stringFree(text)
  end
end

signature :LearnsetTypeIcons, returns: "void", args: { work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetTypeIcons(work)
  if ((!ours(work)) || truth(active.list.count))
    invoke(native("void(*)(void*)", 0x0219b181, 0x0219b141), work)
    return
  end
  for_loop(local(:i, "u32", 0), (i < 4), pre_inc(i)) do
    visible(mem("void*", work, (276 + (i * 4))), false)
  end
end

signature :LearnsetFixedText, returns: "void", args: { work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetFixedText(work)
  if (!ours(work))
    invoke(native("void(*)(void*)", 0x0219a4c5, 0x0219a485), work)
    return
  end
  for_loop(local(:i, "u32", 0), (i < 2), pre_inc(i)) do
    local(:text, "void *", message(mem("void*", work, 68), (23 + i)))
    if truth(text)
      draw(work, (2 + i), 0, 0, text, 1088)
      flush(mem("void*", work, (12 + (i * 4))))
      stringFree(text)
    end
  end
  infoInit(work, active)
end

signature :LearnsetScreen, returns: "void", args: { arc: "void *", member: "u32", frame: "u32", offset: "u32", length: "u32", compressed: "u32", heap: "u32" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetScreen(arc, member, frame, offset, length, compressed, heap)
  local(:original, "auto", native("void(*)(void*,u32,u32,u32,u32,u32,u32)", 0x0204af7d, 0x0204af51))
  if (((!truth(active)) || (member != 2)) || (frame != 7))
    original(arc, member, frame, offset, length, compressed, heap)
    return
  end
  local(:screen, "void *", 0)
  local(:allocation, "void *", invoke(native("void*(*)(void*,u32,u32,void**,u32)", 0x0204b359, 0x0204b32d), arc, member, compressed, address_of(screen), heap))
  if ((((!truth(allocation)) || (!truth(screen))) || (mem("u16", screen, 0) != 256)) || (mem("u32", screen, 8) != 2048))
    releaseNativeAllocation(allocation)
    original(arc, member, frame, offset, length, compressed, heap)
    return
  end
  local(:tiles, "u16 *", reinterpret("u16 *", (cast("u8 *", screen) + 12)))
  for_loop(local(:y, "u32", 8), (y < 21), pre_inc(y)) do
    local(:row, "u16 *", (tiles + (y * 32)))
    row[22] = row[19]
    row[21] = row[18]
    row[18] = assign(row[19], assign(row[20], row[17]))
  end
  local(:size, "const u32", (truth(length) ? length : mem("u32", screen, 8)))
  if truth(invoke(native("void*(*)(u32)", 0x02045841, 0x02045815), frame))
    invoke(native("void(*)(u32,const void*,u32,u32)", 0x0204508d, 0x02045061), frame, tiles, size, offset)
    invoke(native("void(*)(u32)", 0x02044fbd, 0x02044f91), frame)
  else
    invoke(native("void(*)(u32,const void*,u32,u32)", 0x02044fdd, 0x02044fb1), frame, tiles, size, offset)
  end
  releaseNativeAllocation(allocation)
end
