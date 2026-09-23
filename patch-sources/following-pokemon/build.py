"""Build the field, resident event, and registry-extension PMC modules."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from verify import verify
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
WORKSPACE=REPO.parent
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'White2Upgrade/CTRMap.jar'))
PROFILE=os.environ.get('FOLLOWING_PROFILE','stock')
if PROFILE not in ('stock','black2','white2upgrade'):raise ValueError('FOLLOWING_PROFILE must be stock, black2, or white2upgrade')
UPGRADE=PROFILE=='white2upgrade'
BLACK2=PROFILE=='black2'
BUILD=Path(os.environ.get('FOLLOWING_BUILD_DIR', HERE/('build/white2upgrade' if UPGRADE else 'build/black2' if BLACK2 else 'build')))
os.environ['FOLLOWING_BUILD_DIR']=str(BUILD)
VERSION='0.7.18-alpha' if UPGRADE else '0.6.27-alpha'
SUFFIX='B2' if BLACK2 else 'W2'
CONTRACT=HERE/('black2-contract.json' if BLACK2 else 'contract.json')
os.environ['FOLLOWING_MODULE_SUFFIX']=SUFFIX
def run(*args): subprocess.run([str(a) for a in args],check=True)
def dedupe_versions(entries):
    seen=set(); result=[]
    for entry in entries:
        key=entry.get('version')
        if key==VERSION: continue
        if key in seen: continue
        seen.add(key);result.append(entry)
    return result
def build(rom, publish=False):
    if publish and int(os.environ.get('FOLLOWING_TEST_CYCLES','100'))<100:
        raise ValueError('Publishing requires at least 100 conversation/scene test cycles')
    if UPGRADE:
        import hashlib
        contract=json.loads((HERE/'upgrade-contract.json').read_text())
        if hashlib.sha256(Path(rom).read_bytes()).hexdigest()!=contract['sourceRomSha256']:
            raise ValueError('Input does not match the pinned White2Upgrade source ROM SHA-256')
    else: verify(rom)
    BUILD.mkdir(parents=True,exist_ok=True)
    run('npx','vite-node',REPO/'scripts/verify-following-pc-script.ts',rom)
    run('npx','vite-node',REPO/'scripts/verify-following-seam-scripts.ts',rom)
    if (REPO/'src/assets/following/interactions.bin').stat().st_size>8192:
        raise ValueError('Conversation package exceeds the 8 KiB runtime buffer')
    if (REPO/'src/assets/following/contextual-dialogues.narc').stat().st_size>4096:
        raise ValueError('Contextual dialogue archive exceeds the 4 KiB runtime buffer')
    if (REPO/'src/assets/following/contextual-items.narc').stat().st_size>4096:
        raise ValueError('Follower gift archive exceeds the shared 4 KiB runtime buffer')
    for meta in ('metadata.yml','field-metadata.yml','events-metadata.yml'):
        text=(HERE/meta).read_text().replace('0.6.10-alpha',VERSION)
        if BLACK2:text=text.replace('PMCGameID: W2','PMCGameID: B2')
        (BUILD/meta).write_text(text)
    from generate_scene_policy import generate
    generate()
    from black2_port import port_source
    objects=[]
    for name in ['core','object_codes','registry','following','field','effects','reactions','interaction','gifts','events','scene','render','render_math']:
        obj=BUILD/(name+'.o');objects.append(obj)
        source=HERE/(name+'.c')
        if BLACK2:
            source=BUILD/(name+'.c');source.write_text(port_source((HERE/(name+'.c')).read_text()))
        run(TOOLS/'arm-none-eabi-gcc','-mthumb','-mcpu=arm946e-s','-Os','-std=c11',
            '-fno-jump-tables','-ffreestanding','-fvisibility=hidden','-fno-builtin','-fno-unwind-tables','-fno-asynchronous-unwind-tables',
            '-I',HERE,*(['-DFW_UPGRADE=1'] if UPGRADE else []),*(['-DFW_BLACK2=1'] if BLACK2 else []),'-Wall','-Wextra','-Werror','-c',source,'-o',obj)
    def assembly(name):
        source=HERE/name
        if BLACK2:
            source=BUILD/name;source.write_text(port_source((HERE/name).read_text()))
        return source
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',assembly('core.s'),'-o',BUILD/'core-hooks.o')
    # Portable follower code is compiled separately, not pulled into the resident module.
    elf=BUILD/f'PokewebFollowingCore{SUFFIX}.elf'
    run(TOOLS/'arm-none-eabi-ld','-r',*objects[:3],BUILD/'core-hooks.o','-o',elf)
    output=BUILD/f'PokewebFollowingCore{SUFFIX}.dll'
    output.unlink(missing_ok=True)
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',output,
        '--esdb',HERE/'symbols.yml','--meta',BUILD/'metadata.yml','--generate-relocations','--strip')
    dump=subprocess.check_output(['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(output)])
    import re
    targets=re.findall(r'Target: (\S+) @ (\S+) :: (\S+)',dump.decode())
    external=[item for item in targets if item[1]!='base']
    contract_data=json.loads(CONTRACT.read_text())
    expected_core=sorted((h['kind'],h['segment'],hex(h['address'])) for h in contract_data['hooks'] if h.get('module')=='core')
    if sorted(external)!=expected_core:
        raise ValueError('Unexpected core relocation targets: '+repr(external))
    if 'Import symbol' in dump.decode():raise ValueError('Unresolved core imports')
    (BUILD/'core.dump.txt').write_bytes(dump)
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',assembly('events.s'),'-o',BUILD/'events-hooks.o')
    events=BUILD/f'PokewebFollowingEvents{SUFFIX}.elf'
    run(TOOLS/'arm-none-eabi-ld','-r',BUILD/'events.o',BUILD/'events-hooks.o','-o',events)
    events_dll=BUILD/f'PokewebFollowingEvents{SUFFIX}.dll';events_dll.unlink(missing_ok=True)
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',events,'--fourcc','DLXF','-o',events_dll,
        '--esdb',HERE/'symbols.yml','--meta',BUILD/'events-metadata.yml','--generate-relocations','--strip')
    events_dump=subprocess.check_output(['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(events_dll)])
    (BUILD/'events.dump.txt').write_bytes(events_dump)
    if 'Import symbol' in events_dump.decode():raise ValueError('Unresolved event module imports')
    hooks=contract_data['hooks']
    expected=sorted((h['kind'],h['segment'],hex(h['address'])) for h in hooks if h.get('module')=='events')
    actual=sorted(t for t in re.findall(r'Target: (\S+) @ (\S+) :: (\S+)',events_dump.decode()) if t[1]!='base')
    if actual!=expected:raise ValueError('Unexpected event module hooks: '+repr(actual))
    run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',assembly('field.s'),'-o',BUILD/'field-hooks.o')
    field=BUILD/f'PokewebFollowingField{SUFFIX}.elf'
    run(TOOLS/'arm-none-eabi-ld','-r',BUILD/'field.o',BUILD/'effects.o',BUILD/'following.o',BUILD/'reactions.o',BUILD/'interaction.o',BUILD/'gifts.o',BUILD/'scene.o',BUILD/'render.o',BUILD/'render_math.o',BUILD/'field-hooks.o','-o',field)
    field_dll=BUILD/f'PokewebFollowingField{SUFFIX}.dll'
    field_dll.unlink(missing_ok=True)
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',field,'--fourcc','DLXF','-o',field_dll,
        '--esdb',HERE/'field-symbols.yml','--meta',BUILD/'field-metadata.yml','--generate-relocations','--strip')
    field_dump=subprocess.check_output(['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(field_dll)])
    (BUILD/'field.dump.txt').write_bytes(field_dump)
    # Exactly one data import supplies the versioned resident bridge. The
    # packaged verifier resolves it from the resident module's export hashes.
    from verify_packaged import verify_imports
    verify_imports(field_dll,events_dll,output)
    targets=re.findall(r'Target: (\S+) @ (\S+) :: (\S+)',field_dump.decode())
    expected_field=sorted((h['kind'],h['segment'],hex(h['address'])) for h in contract_data['hooks'] if h.get('module')=='field')
    if sorted(t for t in targets if t[1]!='base')!=expected_field:raise ValueError('Unexpected field hooks')
    if field_dll.stat().st_size<1024:raise ValueError('Field DLL was not generated')
    # RPM repacks call instructions; checking only a separately linked ELF can
    # miss invalid ARM/Thumb encodings introduced during DLL generation.
    run(os.environ.get('PYTHON','python3'),HERE/'verify_packaged.py')
    if UPGRADE: run(os.environ.get('PYTHON','python3'),HERE/'verify_interactions.py')
    elif not BLACK2: run(os.environ.get('PYTHON','python3'),HERE/'verify_continuity.py',rom)
    if not BLACK2: run(os.environ.get('PYTHON','python3'),HERE/'verify_render.py')
    if publish:
        import hashlib, shutil
        assets=REPO/'src/assets/following'
        if UPGRADE: assets=assets/'white2upgrade'
        elif BLACK2: assets=assets/'black2'
        assets.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(field_dll,assets/field_dll.name)
        shutil.copyfile(events_dll,assets/events_dll.name)
        shutil.copyfile(output,assets/output.name)
        old_runtime=json.loads((assets/'runtime.json').read_text()) if (assets/'runtime.json').exists() else None
        old_current=({key:old_runtime[key] for key in ('version','fieldSha256','eventsSha256','eventsAbi','coreSha256','coreAbi')} if old_runtime else None)
        previous_versions=dedupe_versions(([old_current] if old_current else [])+(old_runtime.get('previousVersions',[]) if old_runtime else [])) if BLACK2 else dedupe_versions(([old_current] if old_current else [])+(old_runtime.get('previousVersions',[]) if old_runtime else [])+[json.loads((HERE/'stock-0.6.15-receipt.json').read_text()),json.loads((HERE/'stock-0.6.14-receipt.json').read_text()),json.loads((HERE/'stock-0.6.13-receipt.json').read_text()),json.loads((HERE/'stock-0.6.12-receipt.json').read_text()),json.loads((HERE/'stock-0.6.11-receipt.json').read_text()),
            {'version': '0.6.9-alpha', 'fieldSha256': '75646645ec262e5a07dade75af572b490dddabdf1d299ef4885753b9280a813b', 'eventsSha256': 'c99bc16f9745df1b8647cf169f9e2c2de8599b25c05953b395dc649417797fb9', 'eventsAbi': 2, 'coreSha256': '3a442efc82ab76ed525d24931320e51ff9d631c2da3736c4039e9ddc5d231b30', 'coreAbi': 1, 'registrySha256': '30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58', 'descriptorsSha256': 'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939', 'resourcesSha256': 'c18ccf5f1b16b85f33d727f01ca9f8a749ce75bfca20cfec6d74cd6a1249aec6', 'effectsSha256': 'd910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0', 'interactionsSha256': 'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894', 'emotesSha256': 'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version': '0.6.8-alpha', 'fieldSha256': '481b56d37d2be98ff8db891642f76b181c8eb1b5923d6542e6517070e33d0555', 'eventsSha256': '51f3a5ad5aeefcef8b0403607c79ba8c8237f950adf5ec7525d091863f080636', 'eventsAbi': 2, 'coreSha256': '23c286b07ba85a1576551fc56a349dfec79ff1910a5f1817c3863a4a925f7d35', 'coreAbi': 1, 'registrySha256': '30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58', 'descriptorsSha256': 'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939', 'resourcesSha256': 'c18ccf5f1b16b85f33d727f01ca9f8a749ce75bfca20cfec6d74cd6a1249aec6', 'effectsSha256': 'd910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0', 'interactionsSha256': 'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894', 'emotesSha256': 'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.7-alpha','fieldSha256':'23a347b389cddcdd403b2127231424900e1ba7cc0ce58207bb5b4199580824e9','eventsSha256':'9536e2f107454e71fd0b5bf23bc4fe56eaa1a46743823b770f33734fcafd0767','eventsAbi':2,'coreSha256':'0b2e4aea438da6ce6920ce535ee5a4e1bbf18131032fb1fcbc36e071ea6a827b','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'c18ccf5f1b16b85f33d727f01ca9f8a749ce75bfca20cfec6d74cd6a1249aec6','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.6-alpha','fieldSha256':'1ce5f2f4427e9509698a6b279c996b41fc6743e119eb068ccd87fbd2f1517576','eventsSha256':'8643d9351834317c4fa8ef410db5b656283f8c7faaf2d691f662f1e91fb79501','eventsAbi':2,'coreSha256':'f3e6a16dd6c9f16aa9f0318a43112e059c39f948ff7705c890c04acc41ee40bb','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.5-alpha','fieldSha256':'fd317e3657b7113b953adf9dbb7113a3c85c44e2d9f0c67b812646290e16a095','eventsSha256':'97133db4ea175766e8f5eb0b50544cb586e4d755d05125a290f32c63e8c650cd','eventsAbi':2,'coreSha256':'db255cb37a451de3b2b47aaab62cd2f42406fb03d2ed63e13a3d02554487804e','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.4-alpha','fieldSha256':'dc5260432ee8818b30b0273b42636baf81e25e61370775986e6077291110b79c','eventsSha256':'c0dece9a333277ec156f3618381d4d8f5a521325d3ebf05f1bfe04b967a5ed9b','eventsAbi':2,'coreSha256':'d5034231547bc6c80fa139437d3152a0a2222d410c3ff19885df8e82620269c3','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.3-alpha','fieldSha256':'03d328a9dc6122a5230d629b5ea7542a362b1d3c3d12775f4a67eda4f61cd90c','eventsSha256':'90409eab9325a0e2f6b6e2b5c02d535fa48c9e487a6928229658b4795a8d891b','eventsAbi':2,'coreSha256':'4adac80d5710801d4eb3c01c0c33742fc31fba3b9e78cf916d470e9d74479de7','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.2-alpha','fieldSha256':'0ae394f60f1e38ff08053fe54af715cd1cfc27483f14bf6f83f60835a1f24660','eventsSha256':'231832269929065e6dcf6a1cc7f8195b739048376b03e57a43c92ec4ac621557','eventsAbi':1,'coreSha256':'ee0d6185583576d095ab5ab538ec645153ceb7a8708b04670bf3f3fd8bcb0336','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.1-alpha','fieldSha256':'5d8bd1a25a569559cb6d307176676067231ed59922eca9ef4c9cddfea38772b5','eventsSha256':'1a1bffb3034910895a52aac8c00c16c750b7052a9ece1e69204927720cbc11c7','eventsAbi':1,'coreSha256':'43d5a69aa8b76a3493aabd7e12c2d67744faebd87489b975dcccfd5fedb25310','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'4c6c87d7802f4aefa4025bf74386e458fd94cb04912971b43501c7bd74ae0a3f','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.6.0-alpha','fieldSha256':'d74c2a07f78f1d70b6b5fc4859b2bcfb93dbd4ed4fc6550db2e76345069f3065','eventsSha256':'c7e795c8f2d0b2eb7df6ede0fc06b05c96247b9b76f8bacbce61a66c6fa056fa','eventsAbi':1,'coreSha256':'68453359d2db5c840b2ad3b4d17ec0568c123492528b30f4a6a6bcbb84ea0591','coreAbi':1,'registrySha256':'30192d1ca20b6fae62a88421e8b505ac35202d4d5efa5c59fbcf7b62dcce2f58','descriptorsSha256':'f24b7c6833abd6d6a81078235b23875c8d79aac96862ff2b07ca0d26cf779939','resourcesSha256':'6f989c8f8e15435bcc15ad502654716d35e0fd2d2283f2f3ad359102b85d5ac1','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.5.0-alpha','fieldSha256':'2922b042dab14a8f10fd711d71cf92877dda27956c716a3445fc4a4f382cab7d','eventsSha256':'c5f17239556437785e11e1e2cbf392d8a6c37d7fc129e8088874f9b45e399f90','eventsAbi':1,'effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0','interactionsSha256':'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894','emotesSha256':'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version': '0.4.1-alpha', 'fieldSha256': 'b649712174e9fff35c0dbf5853adeadde4866b9c74013849879035f0a57dc2d5', 'effectsSha256': 'd910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0', 'interactionsSha256': 'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894', 'emotesSha256': 'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version': '0.4.0-alpha', 'fieldSha256': '9bd9f47d1fb414bb4c538241d715d89fdd6f89900e4eed69f21e8932c19f3e22', 'effectsSha256': 'd910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0', 'interactionsSha256': 'e0755091c6e7993d6573d0b9e1b574dd22084cf46ad4af3ac2f6313687907894', 'emotesSha256': 'ca753098e14141d4b92a1f151271df099e3a516590d0febd8de911fd6346f1f7'},
            {'version':'0.2.0-alpha','fieldSha256':'ca596c57d768be026e625f6677784c4c588eb141d7f7d751b2739344fa7e6eba','effectsSha256':None},
            {'version':'0.3.1-alpha','fieldSha256':'c6dc102b29bab9fb7cd8a8522f8437e58eab1a423dc4e4193ac18ac991a09a21','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0'},
            {'version':'0.3.0-alpha','fieldSha256':'5ce8ecd2833ff53c4b2531621fff8527508c5931f9d0610de3b8626bdb7c8e5d','effectsSha256':'d910abbbf20657bd180d124a6f888574c8c2f091e02348e707c5fd29e879a5f0'}
        ])
        (assets/'runtime.json').write_text(json.dumps({'version':VERSION,'fieldSha256':hashlib.sha256(field_dll.read_bytes()).hexdigest(),'eventsSha256':hashlib.sha256(events_dll.read_bytes()).hexdigest(),'eventsAbi':4,'coreSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'coreAbi':2,'previousVersions':previous_versions},indent=2)+'\n')
    if publish and UPGRADE:
        manifest=json.loads((assets/'runtime.json').read_text())
        manifest['previousVersions']=dedupe_versions(([old_current] if old_current else [])+(old_runtime.get('previousVersions',[]) if old_runtime else [])+[json.loads((HERE/'upgrade-0.7.6-receipt.json').read_text()),json.loads((HERE/'upgrade-0.7.5-receipt.json').read_text()),json.loads((HERE/'upgrade-0.7.4-receipt.json').read_text()),json.loads((HERE/'upgrade-0.7.3-receipt.json').read_text()),json.loads((HERE/'upgrade-0.7.2-receipt.json').read_text()),json.loads((HERE/'upgrade-0.7.1-receipt.json').read_text())])
        (assets/'runtime.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Follower field module: {field_dll.name} ({field_dll.stat().st_size} bytes). Published: {publish}.')
    print(f'Follower core module: {output.name} ({output.stat().st_size} bytes). Published: {publish}.')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--publish',action='store_true');args=p.parse_args();build(args.rom,args.publish)
