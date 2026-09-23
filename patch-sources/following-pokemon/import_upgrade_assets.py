"""Deterministic White2Upgrade follower import; source ROM and hg-engine are read-only."""
import argparse, hashlib, json, re, unicodedata
from pathlib import Path
import ndspy.rom, ndspy.narc
from import_gen5_assets import parse_sources, resource
from convert_fan_followers import convert

# Explicit audited form offsets; never index into the next species' tag block.
FORMS = {666:list(range(20)),669:list(range(5)),670:list(range(6)),671:list(range(5)),
         676:list(range(10)),678:[0,1],705:[0,1],706:[0,1],710:[0,1,2,3],711:[0,1,2,3],713:[0,1],
         718:[0,1,2],720:[0,1],724:[0,1],801:[0,1],849:[0,1],875:[0,1],876:[0,1],877:[0,1],
         888:[0,1],889:[0,1],892:[0,1],893:[0,1],898:[0,1,2],902:[0,1],905:[0,1],916:[0,1],
         925:[0,1],931:list(range(4)),964:[0,1],978:[0,1,2],982:[0,1],999:[0,1],1017:list(range(4))}
GENDER_TAG = {668:1,678:1,876:1,902:1,916:1}

def norm(s):return re.sub('[^A-Z0-9]+','_',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().upper()).strip('_')

def build(rom_path, engine, names_path, output, png_root=None):
    rom=ndspy.rom.NintendoDSRom.fromFile(rom_path)
    personal=ndspy.narc.NARC(rom.getFileByName('a/0/1/6')).files
    names=names_path.read_text().splitlines();constants,bases,tags=parse_sources(engine)
    table=(engine/'src/field/overworld_table.c').read_text()
    # Species block ownership is an independent check against accidental tag spill.
    owners={};owner=None;labels={}
    for line in table.splitlines():
        m=re.search(r'\.tag\s*=\s*(\d+),\s*\.gfx\s*=\s*(\d+).*?//\s*(.*)',line)
        if not m:continue
        tag,gfx,label=int(m[1]),int(m[2]),m[3]
        if label.startswith('SPECIES_'):owner=label.split()[0][8:]
        owners[tag]=owner;labels[tag]=label
    def file_key(s):return norm(s).replace('_','')
    fan={}
    if png_root:
        for shiny,folder in [(False,'Followers'),(True,'Followers shiny')]:
            fan[shiny]={file_key(p.stem):p for p in (png_root/folder).glob('*.png')}
    mapped=[]
    for species in range(650,1024):
        name=norm(names[species]);tag=bases[name]+0x1e4
        assert constants[name]>constants['SNOVER'] and owners[tag]==name,(species,name,tag,owners.get(tag))
        ratio=personal[species][18];genders=[2] if ratio==255 else [1] if ratio==254 else [0] if ratio==0 else [0,1]
        for form in range(max(1,personal[species][32])):
            for gender in genders:
                offsets=FORMS.get(species,[0]);offset=offsets[form] if form<len(offsets) else 0
                reasons=[]
                if form>=len(offsets):reasons.append('Form artwork not mapped; base-form substitute.')
                if form==0 and gender==1 and species in GENDER_TAG:offset=GENDER_TAG[species]
                source_tag=tag+offset
                if owners.get(source_tag)!=name:
                    source_tag=tag;reasons.append('Requested alternate artwork is absent from the source species block.')
                gfx=tags[source_tag]
                if gfx==297:reasons.append('hg-engine overworld table uses its shared missing-art placeholder.')
                if form and gfx==tags[tag] and species in (710,711):reasons.append('Source reuses base size artwork for this form.')
                for shiny in (False,True):
                    source=None;fan_reasons=[]
                    if png_root:
                        basename=file_key(names[species]);basename='POLTHCAGEIST' if species==1012 else basename
                        # Only verified ordinary form IDs may select a numbered sheet.
                        # Expansion-added Mega IDs must not accidentally select an unrelated form.
                        mapped_form=form if form<len(FORMS.get(species,[0])) or species==774 else 0
                        if species==718 and form==3:mapped_form=0
                        female=(gender==1 and species in GENDER_TAG)
                        if species in (678,876,902,916) and form==1:female=True;mapped_form=0
                        candidates=[]
                        if mapped_form:candidates.append(basename+str(mapped_form))
                        if female:candidates.append(basename+'FEMALE')
                        if not mapped_form:candidates.append(basename)
                        # Minior's first seven forms are visually identical meteor shells.
                        if species==774 and form<7:candidates=[basename]
                        for candidate in candidates:
                            source=fan[shiny].get(candidate)
                            if source:break
                        if source and form and not mapped_form and not (species==774 and form<7) and not (female and form==1):
                            fan_reasons.append('Unmapped expanded form uses the base-form PNG.')
                        if not source and form and reasons:
                            source=fan[shiny].get(basename)
                            if source:fan_reasons.append('Requested form PNG is missing; using its base-form sheet.')
                        if not source:
                            # Missing shiny sheet uses the corresponding normal artwork explicitly.
                            for candidate in candidates:
                                source=fan[False].get(candidate)
                                if source:break
                            if source:fan_reasons.append('Shiny PNG missing; normal-palette substitute.')
                    mapped.append(dict(species=species,form=form,gender=gender,shiny=shiny,gfx=gfx,
                        sourcePng=str(source.relative_to(png_root)) if source else None,
                        placeholder=bool(fan_reasons if source else reasons),placeholderReason=' '.join(fan_reasons if source else reasons) or None))
    rows=[];members={};files=[]
    def source_key(m):return ('png',m['sourcePng']) if m['sourcePng'] else ('hg-engine',m['gfx'],m['shiny'])
    for key in sorted({source_key(m) for m in mapped}):
        conversion={};repairs=[]
        if key[0]=='png':
            data,size,profile,conversion=convert(png_root/key[1]);gfx=-1;shiny=key[1].startswith('Followers shiny/')
            indices=list(range(8 if size==32 else 6))
        else:
            _,gfx,shiny=key
            data,size,profile,indices,repairs=resource(engine/'data/graphics/overworlds',gfx,shiny)
        member=len(files);files.append(data);members[key]=member
        rows.append(dict(member=member,gfx=gfx,shiny=shiny,size=size,profile=profile,sourceFrameIndices=indices,paletteRepairs=repairs,
                         source='fan-png' if key[0]=='png' else 'hg-engine',sourcePath=key[1] if key[0]=='png' else f'{gfx:04}.png',conversion=conversion,
                         bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
    for m in mapped:
        member=members[source_key(m)];m.pop('gfx');m.pop('sourcePng');r=rows[member]
        m.update(member=member,size=r['size'],profile=r['profile'])
        if r['paletteRepairs']:
            m['placeholder']=True;m['placeholderReason']=((m['placeholderReason'] or '')+' Missing shiny palette entries use normal colors.').strip()
    narc=ndspy.narc.NARC();narc.files=files;data=narc.save()
    manifest=dict(schemaVersion=1,speciesMin=650,speciesMax=1023,appearances=mapped,resources=rows,archiveSha256=hashlib.sha256(data).hexdigest())
    output.mkdir(parents=True,exist_ok=True)
    (output/'later-followers.narc').write_bytes(data);(output/'later-followers.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'{len(mapped)} appearances, {len(files)} resources, {sum(m["placeholder"] for m in mapped)} explicit placeholders')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('engine',type=Path);p.add_argument('names',type=Path);p.add_argument('--png-root',type=Path);p.add_argument('--output',type=Path,default=Path(__file__).parents[2]/'src/assets/following/white2upgrade');a=p.parse_args();build(a.rom,a.engine,a.names,a.output,a.png_root)
