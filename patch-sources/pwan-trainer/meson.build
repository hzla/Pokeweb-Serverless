pwan_summary_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_summary_anim.cpp',
  'w2u_summary_hooks.s',
)

pwan_battle_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_battle_anim.cpp',
  'w2u_battle_hooks.s',
)

pwan_misc_sources = files(
  'w2u_pwan_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_nonbattle_mcss.cpp',
  'w2u_egg_hatch_anim.cpp',
  'w2u_evolution_anim.cpp',
  'w2u_nonbattle_hooks.s',
)

pwan_battle_b2_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_battle_anim.cpp',
  'b2_battle_hooks.s',
)

pwan_summary_b2_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_summary_anim.cpp',
  'b2_summary_hooks.s',
)

pwan_misc_b2_sources = files(
  'w2u_pwan_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_nonbattle_mcss.cpp',
  'w2u_egg_hatch_anim.cpp',
  'w2u_evolution_anim.cpp',
  'b2_nonbattle_hooks.s',
)

pwan_trainer_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_trainer_anim.cpp',
  'w2u_trainer_hooks.s',
)

pwan_trainer_b2_sources = files(
  'w2u_pwan_frame_scratch.cpp',
  'w2u_pwan_archive.cpp',
  'w2u_trainer_anim.cpp',
  'b2_trainer_hooks.s',
)

pwan_runtime_modules = [
  {
    'name': 'PokewebPwanSummaryW2',
    'sources': pwan_summary_sources,
    'overlays': ['207'],
  },
  {
    'name': 'PokewebPwanBattleW2',
    'sources': pwan_battle_sources,
    'overlays': ['168', '167'],
  },
  {
    'name': 'PokewebPwanMiscW2',
    'sources': pwan_misc_sources,
    'overlays': ['298', '284', '307', '265'],
  },
  {
    'name': 'PokewebPwanTrainerW2',
    'sources': pwan_trainer_sources,
    'overlays': ['168'],
  },
]

pwan_runtime_depend_files = files(
  'pwan_types.h',
  'w2u_pwan_archive.h',
) + files(
  '../../include/stdint.h',
  '../../include/swan/swantypes.h',
  '../../include/swan/nds/fs.h',
)
