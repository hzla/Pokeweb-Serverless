# Parsed typed Ruby source; edit this file, then rebuild.

global :session, { type: "Request *", scope: "private" }

global :sessionOwner, { type: "void *", scope: "private" }

global :restoreSlot, { type: "u32", scope: "private" }, cast("unsigned int", 4294967295)

signature :isField, returns: "bool", args: { work: "void *" }, scope: "private"
def isField(work)
  return ((truth(work) && truth(mem("void*", work, PartyRequestOffset))) && (mem("u32", mem("void*", work, PartyRequestOffset), RequestModeOffset) == 0))
end

signature :viewerTable, returns: "const ProcTable *", args: {  }, scope: "private"
def viewerTable()
  return native("const ProcTable*", 0x0219b9e8, 0x0219b9a8)
end

signature :viewerInit, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "private"
def viewerInit(proc, seq, data, work)
  local(:init, "const Proc", viewerTable().init)
  if ((init == native("Proc", 0x02199901, 0x021998c1)) || (!truth(init)))
    return 1
  end
  if (session != data)
    return 1
  end
  return init(proc, seq, data, work)
end

signature :viewerMain, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "private"
def viewerMain(proc, seq, data, work)
  return ((truth(session) && truth(session.viewerStarted)) ? invoke(viewerTable().main, proc, seq, data, work) : 1)
end

signature :viewerEnd, returns: "u32", args: { proc: "void *", seq: "int *", data: "void *", work: "void *" }, scope: "private"
def viewerEnd(proc, seq, data, work)
  return ((truth(session) && truth(session.viewerStarted)) ? invoke(viewerTable().end, proc, seq, data, work) : 1)
end

global :callbacks, { type: "const ProcTable", scope: "private" }, aggregate("const ProcTable", viewerInit, viewerMain, viewerEnd)

signature :reopen, returns: "void", args: { work: "void *", seq: "int *" }, scope: "private"
def reopen(work, seq)
  assign(mem("u32", work, 4), 0)
  assign(mem("u32", work, 8), 0)
  assign(mem("u32", work, 12), 0)
  assign(mem("u32", work, 16), 4)
  assign(deref(seq), 11)
end

# Prepare a read-only tutor request and open the viewer overlay.
signature :launch, returns: "bool", args: { slot: "u32", family: "bool" }, scope: "private"
def launch(slot, family)
  local(:count, "const u32", partyCount(session.party))
  if ((slot >= count) || (count > 6))
    return false
  end
  local(:pokemon, "void *", partyPokemon(session.party, slot))
  if (!viewable(pokemon))
    return false
  end
  if family
    if (!truth(session.nextView.identity.species))
      return false
    end
    session.view = session.nextView
  else
    session.view = aggregate("ViewSelection", aggregate("ViewIdentity", cast("u16", pokemonGet(pokemon, 5)), cast("u16", pokemonGet(pokemon, 111))), aggregate("ViewIdentity", 0, 0))
  end
  session.nextView = aggregate("ViewSelection")
  session.partySlot = slot
  session.nextSlot = 255
  session.viewerStarted = 0
  session.tutor = aggregate("TutorData", pokemon, session.tutor.trainer, nil, session.tutor.gameSystem, session.ids, 0, 0, 0, 254, 0, 0)
  buildList(session, 4)
  for_loop(local(:i, "u32", 0), (i < (MaxEntries + 1)), pre_inc(i)) do
    session.ids[i] = End
  end
  for_loop(local(:i, "u32", 0), (i < session.list.count), pre_inc(i)) do
    session.ids[i] = session.list.entries[i].moveId
  end
  if (!truth(session.list.count))
    session.ids[0] = 1
  end
  restoreSlot = slot
  invoke(native("void(*)(void*,u32,const void*,void*)", 0x02016a99, 0x02016a99), session.tutor.gameSystem, TutorOverlay, address_of(callbacks), session)
  return true
end

# Append the command only when the field party menu has capacity.
signature :LearnsetMenuCreate, returns: "void", args: { work: "void *", rawMenu: "void *", input: "u32 *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetMenuCreate(work, rawMenu, input)
  OriginalMenuCreate(work, rawMenu, input)
  local(:menu, "MenuWork *", cast("MenuWork *", rawMenu))
  if ((!canAppend(input, menu.count, isField(work))) || (menu.ids[(menu.count - 1)] != 6))
    return
  end
  local(:append, "auto", callback(returns: "void", args: { id: "u16", command: "u16" }) do
  if (menu.count >= 8)
    return
  end
  local(:text, "void *", message(mem("void*", work, PartyMessageOffset), id))
  if (!truth(text))
    return
  end
  local(:index, "const u32", (menu.count - 1))
  menu.ids[(index + 1)] = menu.ids[index]
  menu.items[(index + 1)] = menu.items[index]
  menu.ids[index] = command
  menu.items[index] = aggregate("MenuItem", text, 14816, 0, 0)
  pre_inc(menu.count)
end)
  if (truth(customUiConfig.learnsetEnabled) && configured(learnsetConfig.menu, learnsetConfig.menuXor))
    invoke(append, learnsetConfig.menu, Command)
  end
  if (((customUiConfig.version == 1) && (customUiConfig.enabled == 1)) && configured(customUiConfig.menu, customUiConfig.menuXor))
    invoke(append, customUiConfig.menu, CustomCommand)
  end
end

signature :LearnsetMenuSelect, returns: "void", args: { work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetMenuSelect(work)
  if (isField(work) && ((mem("u32", work, PartyCommandOffset) == Command) || ((mem("u32", work, PartyCommandOffset) == CustomCommand) && (customUiConfig.enabled == 1))))
    local(:data, "void *", mem("void*", work, PartyRequestOffset))
    assign(mem("u8", work, 12), 19)
    assign(mem("u32", data, RequestSlotOffset), mem("u32", work, PartySlotOffset))
    assign(mem("u32", data, RequestResultOffset), ((mem("u32", work, PartyCommandOffset) == CustomCommand) ? CustomTransition : Transition))
    return
  end
  OriginalMenuSelect(work)
end

# Own the request across application transitions and release it on exit.
signature :LearnsetDispatch, returns: "u32", args: { event: "void *", seq: "int *", work: "void *" }, scope: "global", qualifiers: ["extern_c"]
def LearnsetDispatch(event, seq, work)
  local(:partyData, "void *", mem("void*", work, 28))
  local(:field, "const bool", (((mem("u32", work, 4) == 0) && truth(partyData)) && (mem("u32", partyData, RequestModeOffset) == 0)))
  if (((deref(seq) == 13) && truth(session)) && (sessionOwner == work))
    if (((!truth(session.viewerStarted)) && (session.nextSlot == BrowseFamily)) && launch(session.partySlot, true))
      assign(deref(seq), 12)
      return 0
    end
    if ((((!truth(session.viewerStarted)) && (session.nextSlot != 255)) && (session.nextSlot != session.partySlot)) && launch(session.nextSlot, false))
      assign(deref(seq), 12)
      return 0
    end
    session.magic = 0
    local(:old, "Request *", session)
    session = 0
    release(old)
    reopen(work, seq)
    return 0
  end
  if (((deref(seq) == 13) && field) && ((mem("u32", partyData, RequestResultOffset) == Transition) || ((mem("u32", partyData, RequestResultOffset) == CustomTransition) && (customUiConfig.enabled == 1))))
    local(:custom, "const bool", (mem("u32", partyData, RequestResultOffset) == CustomTransition))
    assign(mem("u32", partyData, RequestResultOffset), 0)
    local(:slot, "const u32", mem("u32", partyData, RequestSlotOffset))
    local(:gs, "void *", deref(mem("void**", work, 24)))
    local(:gd, "void *", invoke(native("void*(*)(void*)", 0x02016ad9, 0x02016ad9), gs))
    local(:party, "void *", invoke(native("void*(*)(void*)", 0x0201735d, 0x0201735d), gd))
    local(:count, "const u32", partyCount(party))
    restoreSlot = (((slot < count) && (slot < 6)) ? slot : 0)
    sessionOwner = work
    if (((slot < count) && (slot < 6)) && (!truth(session)))
      session = cast("Request *", alloc(4, size_of("Request")))
      if truth(session)
        assign(deref(session), aggregate("Request"))
        session.magic = RequestMagic
        session.version = RequestVersion
        session.size = size_of("Request")
        session.party = party
        session.reserved = (custom ? CustomCommand : 0)
        session.tutor.trainer = invoke(native("void*(*)(void*)", 0x0201736d, 0x0201736d), gd)
        session.tutor.gameSystem = gs
        if launch(slot, false)
          assign(deref(seq), 12)
          return 0
        end
        session.magic = 0
        release(session)
        session = nil
      end
    end
    reopen(work, seq)
    return 0
  end
  local(:restoring, "const bool", (((deref(seq) == 11) && (sessionOwner == work)) && (restoreSlot != cast("unsigned int", 4294967295))))
  local(:result, "const u32", OriginalDispatch(event, seq, work))
  if (restoring && (deref(seq) == 12))
    local(:next_value, "void *", mem("void*", work, 28))
    if truth(next_value)
      assign(mem("u32", next_value, RequestSlotOffset), restoreSlot)
    end
    restoreSlot = cast("unsigned int", 4294967295)
    sessionOwner = 0
  end
  return result
end
