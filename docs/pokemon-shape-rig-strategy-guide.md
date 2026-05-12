# Pokemon Shape Rig Strategy Guide

This guide maps the Pokédex shape/body-style families into first-pass Gen 5 rigging strategies. Use it after reading the normalized frame analysis, but before choosing cells. The goal is not to replace visual inspection; it is to give the analysis output body-language so regions like "middle yellow/brown region" can become "torso", "tail", "wing pair", "head base", or "leg cluster" faster.

Reference taxonomy: Bulbapedia's "List of Pokémon by shape" describes 14 Pokédex shape categories and notes that the English descriptions are fan-created labels for in-game shape icons. Use the article to identify a Pokémon's shape family, then apply the corresponding strategy below.

Source: https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_shape#List_of_Pok%C3%A9mon_by_shape

## How To Use This Index

1. Look up the Pokémon in the shape article and record its shape family.
2. Read the normalized front/back contact sheets and motion report.
3. Use the family strategy to name likely cells, especially when analysis regions are too broad or too sparse.
4. Prefer 3-8 cells per side unless the sprite has obvious large appendages.
5. Apply the joint-overlap rules from `pokemon-rig-animation-generation-guide.md`: central connected mass should not split open during motion.
6. Validate frame 0 and a small motion stress preview at the largest planned rotations/translations.

Do not let the shape family override the sprite. Forms, poses, held objects, cloaks, flames, tails hidden behind the body, and asymmetric designs may require a local exception.

## Universal Interpretation Heuristics

- Top protrusions are usually ears, horns, crests, hair tufts, antennae, or head fins. Give them collar overlap from the head if they rotate.
- Bottom two protrusions on bipedal families are usually feet/legs. If they are small and mostly static, merge them into lower body.
- Long rear or side protrusions on tailed families are usually tails. Tail cells need root underpaint on the body and should sit behind the torso unless the contact sheet proves otherwise.
- Wide side protrusions above the midline are usually wings, fins, ears, arms, or shoulder ornaments. Use motion masks to decide whether they flap, wag, or stay with the body.
- Thin lines or sticks are usually weapons, whiskers, vines, antennae, or tails. They are high-risk for palette and seam artifacts; keep motion small unless the base is covered.
- Central shapes such as head, neck, shell, torso, belly, and cloak should either be one cell or move together. If they split, add an underpaint bridge.
- If a family implies limbs but the frame-0 sprite hides them, do not invent visible art. Animate with conservative body bob/tilt and document hidden/occluded parts.

## Shape Family Index

### 0. Only A Head

Examples of likely structure: round head/body mass, face markings, small ears/horns/hair tufts, maybe a floating base shadow.

Default cells:
- Main head/body mass.
- Face/markings only if they visibly shift or blink.
- Top protrusions if they are long enough to rotate.
- Small bottom shadow/base if it moves separately.

Animation strategy:
- Use whole-body bob, squash, and tiny tilt.
- Keep facial elements attached to the main head unless there is clear independent motion.
- Avoid over-splitting round outlines; round bodies expose seams quickly.

Analysis clues:
- One large moving region usually means squash/stretch, not many separate limbs.
- Sparse top motion is probably a tuft/horn/ear.

Risk:
- A circular body broken into wedges will look cracked. Use a single core cell plus small protrusions.

### 1. Head And Legs

Examples of likely structure: head-dominant body, two legs/feet, sometimes small arms or ears.

Default cells:
- Head/core mass.
- Left leg/foot and right leg/foot, or one lower-leg cluster if tiny.
- Ears/horns/hair tufts if present.
- Optional arms if visible.

Animation strategy:
- Head/core gets the main bob.
- Feet move very little unless the source has a walking bounce.
- Keep leg roots underpainted by the head/core.

Analysis clues:
- Bottom two regions are feet/legs even if the motion report calls them lower mixed-color regions.
- The biggest region is usually the head/core, not a separate torso.

Risk:
- Lifting the head can detach it from legs. Add lower-body underpaint or keep legs tucked under the core.

### 2. Fins

Examples of likely structure: fish body, tail fin, side fins, dorsal fin, head/mouth markings.

Default cells:
- Main body/head.
- Tail fin or rear tail section.
- Left/right side fins.
- Dorsal or top fin if visible.

Animation strategy:
- Body uses gentle swim bob/tilt.
- Tail fin wags around its root; side fins rotate slightly.
- Keep fin bases duplicated as body underpaint.

Analysis clues:
- Rear crescent/triangle is likely tail fin.
- Thin top or bottom protrusions are fins, not legs.

Risk:
- Tail wag can leave body holes if the tail root is cut flush.

### 3. Insectoid Body

Examples of likely structure: segmented body, head, thorax/abdomen, antennae, legs, wings, claws.

Default cells:
- Central thorax/abdomen or one main body.
- Head if clearly hinged.
- Wing pair(s), if present.
- Antennae or large claws.
- Leg clusters, not every tiny leg unless large and animated.

Animation strategy:
- Wings flap with mirrored rotation/scale.
- Antennae sway lightly.
- Body segments can bob together; avoid separating central segments unless overlap is strong.

Analysis clues:
- Many tiny intermittent pixels often mean legs/antennae noise; group them.
- Large symmetric side regions near top are wings.

Risk:
- Over-splitting legs creates noisy crawling artifacts. Group small appendages.

### 4. Quadruped Body

Examples of likely structure: head, torso, four legs, tail, ears/horns/mane.

Default cells:
- Torso/core body.
- Head/neck as one cell if it nods; otherwise merge with torso.
- Front-leg cluster and rear-leg cluster, or individual legs if large.
- Tail.
- Ears/horns/mane protrusions when visible.

Animation strategy:
- Body bob is primary.
- Head nod is small and needs neck underpaint.
- Tail wags behind the body.
- Feet should stay grounded unless the source clearly lifts them.

Analysis clues:
- Bottom four protrusions are legs/feet; group by front/back if tiny.
- Long rear protrusion is tail.

Risk:
- Head/body separation is common. Use neck bridge underpaint or identical head/body translation.

### 5. Two Or More Pairs Of Wings

Examples of likely structure: small body, multiple wings, antennae, legs, tail/abdomen.

Default cells:
- Body/core.
- Upper wing pair.
- Lower wing pair.
- Head/antennae if visible.
- Abdomen/tail if distinct.

Animation strategy:
- Wings are the main animation. Use alternating rotations/scales between pairs.
- Body bob should be gentle.
- Keep wing roots filled by body underpaint.

Analysis clues:
- Multiple side lobes at different heights are separate wing pairs.
- Repeated broad motion in side regions indicates flapping.

Risk:
- Wing roots become transparent gaps if the body does not retain socket fill.

### 6. Multiple Bodies

Examples of likely structure: several heads, clusters, satellites, linked or floating pieces.

Default cells:
- Each major body/head as a cell.
- Shared base/core if present.
- Connector/stem/chain underlay if bodies touch.
- Small satellites only if large enough to read.

Animation strategy:
- Give each body a phase-shifted bob/tilt.
- If bodies are connected, preserve connector underpaint.
- If bodies float separately in source art, separation is allowed.

Analysis clues:
- Similar repeated regions are separate bodies, not limbs.
- Motion regions may overlap because each body bobs differently.

Risk:
- Connected multi-head designs can look severed. Separate only where the design is actually disconnected or bridged.

### 7. Tentacles Or Multiped Body

Examples of likely structure: central head/body, many tentacles/legs, skirt-like lower appendages.

Default cells:
- Central body/head.
- Left tentacle/leg cluster.
- Right tentacle/leg cluster.
- Front tentacle/leg cluster.
- Large individual tentacles only when visually important.

Animation strategy:
- Central body bob plus clustered limb sway.
- Avoid rotating many one-pixel-thin appendages independently.
- Use underpaint at the body skirt/root.

Analysis clues:
- Dense lower motion is usually a tentacle/leg cluster.
- Sparse intermittent tips may be deformation; group rather than over-split.

Risk:
- Too many independent tentacles produce noisy gaps and flicker.

### 8. Head And Base

Examples of likely structure: upright head/upper body with a base, cloak, shell, stem, pedestal, or lower mass.

Default cells:
- Head/upper mass.
- Base/lower mass.
- Side appendages or leaves/arms.
- Top protrusions.
- Hidden bridge/neck underpaint whenever head and base split.

Animation strategy:
- Prefer one central core if the head and base form a continuous silhouette.
- If split, head motion must be tiny and base must include upper stump underpaint.
- Base usually gets bob/squash, not independent rotation.

Analysis clues:
- Large lower stable region is base/cloak/shell.
- Top moving region may be head tilt or body squash.

Risk:
- This shape is highly vulnerable to visual bisection between head and base.

### 9. Bipedal, Tailed Form

Examples of likely structure: head, torso, two legs/feet, two arms, tail, ears/horns/hair.

Default cells:
- Torso/core.
- Head/neck, or merged head+torso if compact.
- Tail with body-root underpaint.
- Left/right arm or arm cluster.
- Leg/foot cluster or individual feet.
- Ears/horns/hair as needed.

Animation strategy:
- Tail is the expected long rear protrusion; look for it before assigning side motion to an arm.
- Bottom two protrusions are feet/legs.
- Arms can swing lightly.
- Head bob/nod requires neck bridge underpaint.

Analysis clues:
- Long side/rear appendage is probably tail even when it shares body colors.
- Lower pair of dark or light protrusions are feet.
- A central moving region often means body bounce rather than separate head/torso cells.

Risk:
- Tail roots and head/torso splits are the usual gap sources. Duplicate hidden fill on the parent body.

### 10. Bipedal, Tailless Form

Examples of likely structure: head, torso, arms, legs/feet, hair/horns, held item.

Default cells:
- Torso/core.
- Head/neck.
- Arm cells, especially if hands or weapons move.
- Leg/foot cluster.
- Hair/horns/hat-like protrusions.
- Held item as a separate cell if thin or animated.

Animation strategy:
- Human-like silhouette: head and torso should move together unless neck fill is strong.
- Arms are usually the safest moving appendages.
- Feet should stay planted unless source animation lifts them.

Analysis clues:
- Side protrusions near torso are arms.
- Thin diagonal lines may be held objects, not limbs.

Risk:
- Separating torso from hips/legs can bisect the sprite. Use one lower-body cluster or underpaint.

### 11. Single Pair Of Wings

Examples of likely structure: bird/bat body, two wings, head/beak, tail feathers, legs/claws.

Default cells:
- Body/core.
- Left wing.
- Right wing.
- Head/beak if it nods.
- Tail feathers.
- Leg/claw cluster.

Animation strategy:
- Wing flap is primary and mirrored.
- Body bob/tilt follows wing beat.
- Tail feathers wag/tilt lightly.
- Wing roots need body underpaint.

Analysis clues:
- Large symmetric side regions are wings.
- Rear lower fan is tail feathers.

Risk:
- Wings often overlap the body in frame 0; make deliberate sockets and z-order.

### 12. Serpentine Body

Examples of likely structure: head, long body coil/segments, tail tip, fins/whiskers/horns.

Default cells:
- Head.
- Main body/coil as one large cell, or 2-3 overlapping body sections.
- Tail tip.
- Fins/whiskers/horns if large.

Animation strategy:
- Use whole-body sway or 2-3 phase-shifted segment rotations.
- Keep segment overlap generous; each section should cover the next section's root.
- Avoid many narrow slices unless the source clearly undulates.

Analysis clues:
- Long continuous changed region is body deformation, not many independent parts.
- Tail tip may be the only safe separate cell.

Risk:
- Straight slice cuts make serpentine bodies look segmented or broken. Overlap sections heavily.

### 13. Head And Arms

Examples of likely structure: head/core mass, arms/hands, maybe floating body or small base.

Default cells:
- Head/core.
- Left arm/hand.
- Right arm/hand.
- Hair/horns/face markings if needed.
- Optional base/shadow.

Animation strategy:
- Arms are primary motion cells.
- Head/core gets a subtle bob.
- Arm sockets need underpaint on the core.

Analysis clues:
- Side protrusions are arms/hands, not wings unless the shape/article says winged form.
- Bottom area may be absent or only shadow.

Risk:
- Large arm swings expose holes at shoulders without core underpaint.

## Shape-Specific Planning Notes For Imported Gen 6 Starters

- Quilladin: bipedal, tailed form. Expect two feet, two arms/claws, a compact shell/body mass, head/face/spikes, and possible tail/back protrusion. Treat shell and face/body as central connected mass; use underpaint if head/spikes move.
- Fennekin: quadruped or small mammal pose despite a compact sprite. Expect ears, head/core, small legs, and tail. Ear roots and tail root need underpaint.
- Braixen: bipedal, tailed form. Expect ears, head, torso/skirt, arms/wand, legs, and tail. Head/body and ear/head joints are high-risk; use underpaint and small rotations.
- Froakie: head-and-legs or compact biped-like pose. Expect eye/head bumps, bubble collar, arms, and feet. Bubble collar should usually bridge central body motion.
