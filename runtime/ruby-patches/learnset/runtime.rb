# Parsed typed Ruby source; edit this file, then rebuild.

signature :alloc, returns: "void *", args: { heap: "u32", size: "u32" }, scope: "global", qualifiers: ["inline"]
def alloc(heap, size)
  return invoke(native("void*(*)(u32,u32)", 0x02039dc9, 0x02039d9d), heap, size)
end

signature :release, returns: "void", args: { p: "void *" }, scope: "global", qualifiers: ["inline"]
def release(p)
  if truth(p)
    invoke(native("void(*)(void*)", 0x0203a279, 0x0203a24d), p)
  end
end

signature :releaseNativeAllocation, returns: "void", args: { p: "void *" }, scope: "global", qualifiers: ["inline"]
def releaseNativeAllocation(p)
  release(p)
end

signature :pokemonGet, returns: "u32", args: { p: "void *", field: "u32" }, scope: "global", qualifiers: ["inline"]
def pokemonGet(p, field)
  return invoke(native("u32(*)(void*,u32,void*)", 0x0201cd25, 0x0201ccf9), p, field, 0)
end

signature :viewIdentity, returns: "ViewIdentity", args: { request: "const Request *" }, scope: "global", qualifiers: ["inline"]
def viewIdentity(request)
  if truth(request.view.identity.species)
    return request.view.identity
  end
  return aggregate("ViewIdentity", cast("u16", pokemonGet(request.tutor.pokemon, 5)), cast("u16", pokemonGet(request.tutor.pokemon, 111)))
end

signature :partyCount, returns: "u32", args: { party: "void *" }, scope: "global", qualifiers: ["inline"]
def partyCount(party)
  return (truth(party) ? invoke(native("u32(*)(void*)", 0x0201fe25, 0x0201fdf9), party) : 0)
end

signature :partyPokemon, returns: "void *", args: { party: "void *", slot: "u32" }, scope: "global", qualifiers: ["inline"]
def partyPokemon(party, slot)
  return invoke(native("void*(*)(void*,u32)", 0x0201ff35, 0x0201ff09), party, slot)
end

signature :viewable, returns: "bool", args: { pokemon: "void *" }, scope: "global", qualifiers: ["inline"]
def viewable(pokemon)
  return ((truth(pokemon) && truth(pokemonGet(pokemon, 5))) && (!truth(pokemonGet(pokemon, 76))))
end

signature :message, returns: "void *", args: { handle: "void *", id: "u32" }, scope: "global", qualifiers: ["inline"]
def message(handle, id)
  return invoke(native("void*(*)(void*,u32)", 0x020489b9, 0x0204898d), handle, id)
end

signature :messageOpen, returns: "void *", args: { bank: "u32", heap: "u32" }, scope: "global", qualifiers: ["inline"]
def messageOpen(bank, heap)
  return invoke(native("void*(*)(u32,u32,u32,u32)", 0x02048789, 0x0204875d), 0, 2, messageBank(bank), heap)
end

signature :messageClose, returns: "void", args: { p: "void *" }, scope: "global", qualifiers: ["inline"]
def messageClose(p)
  invoke(native("void(*)(void*)", 0x02048801, 0x020487d5), p)
end

signature :stringFree, returns: "void", args: { p: "void *" }, scope: "global", qualifiers: ["inline"]
def stringFree(p)
  invoke(native("void(*)(void*)", 0x02048591, 0x02048565), p)
end

signature :stringCreate, returns: "void *", args: { size: "u32" }, scope: "global", qualifiers: ["inline"]
def stringCreate(size)
  return invoke(native("void*(*)(u32,u32)", 0x0204855d, 0x02048531), size, 79)
end

signature :stringSet, returns: "void", args: { p: "void *", text: "const u16 *" }, scope: "global", qualifiers: ["inline"]
def stringSet(p, text)
  invoke(native("void(*)(void*,const u16*)", 0x02048641, 0x02048615), p, text)
end

signature :stringText, returns: "const u16 *", args: { p: "void *" }, scope: "global", qualifiers: ["inline"]
def stringText(p)
  return invoke(native("const u16*(*)(void*)", 0x0204871d, 0x020486f1), p)
end

signature :configured, returns: "bool", args: { value: "u16", inverse: "u16" }, scope: "global", qualifiers: ["inline"]
def configured(value, inverse)
  return ((value != End) && (cast("u16", (value ^ inverse)) == End))
end

signature :buildList, returns: "void", args: { request: "Request *", heap: "u32" }, scope: "global", qualifiers: ["inline"]
def buildList(request, heap)
  request.list = aggregate("List")
  request.list.status = enum_value("Status", "Unavailable")
  local(:moveArc, "void *", invoke(native("void*(*)(u32,u32)", 0x0204aa5d, 0x0204aa31), 21, heap))
  if (!truth(moveArc))
    return
  end
  local(:count, "auto", native("u32(*)(void*)", 0x0204adad, 0x0204ad81))
  local(:moveCount, "const u32", count(moveArc))
  invoke(native("void(*)(void*)", 0x0204ab39, 0x0204ab0d), moveArc)
  local(:identity, "const auto", viewIdentity(request))
  local(:personalId, "const u32", invoke(native("u32(*)(u32,u32)", 0x020204ad, 0x02020481), identity.species, identity.form))
  local(:arc, "u32[20]", aggregate("u32[20]"))
  invoke(native("void(*)(void*)", 0x02070ca9, 0x02070c7d), arc)
  if (!truth(invoke(native("u32(*)(void*,const char*)", 0x02070ecd, 0x02070ea1), arc, "a/0/1/8")))
    return
  end
  local(:fileSize, "const u32", invoke(native("u32(*)(void*)", 0x02070ded, 0x02070dc1), arc))
  local(:bytes, "u8[132]")
  local(:size, "const u32", readMember(fileSize, personalId, bytes, size_of_expr(bytes), callback(returns: "bool", args: { offset: "u32", data: "u8 *", length: "u32" }) do
  if (!truth(invoke(native("u32(*)(void*,u32,u32)", 0x02070e55, 0x02070e29), arc, offset, 0)))
    return false
  end
  return (invoke(native("int(*)(void*,void*,u32)", 0x02070e6d, 0x02070e41), arc, data, length) == cast("int", length))
end))
  if truth(size)
    request.list = parse(bytes, size, moveCount)
  end
  invoke(native("u32(*)(void*)", 0x02070de1, 0x02070db5), arc)
end
