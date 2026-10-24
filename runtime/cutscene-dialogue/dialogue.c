#include <stdint.h>

typedef uint32_t u32;
typedef void (*Task)(void *, u32 *);
typedef void (*Cue)(void *, void *, const int32_t *);
typedef u32 (*Keys)(void);
typedef void *(*CreateTask)(void *, Task, u32, u32);
typedef u32 *(*TaskData)(void *);
typedef void (*InitText)(void *, u32 *, u32, u32, u32, u32, u32, u32, u32);

struct DialogueState {
    u32 magic;
    void *manager;
    u32 *scene;
    u32 savedStep, waiting, released, opened;
    void *task;
    u32 *data;
    u32 mode, choiceCount, choiceIndex, firstMessage, bank;
    u32 targets[3];
    u32 *jumpScene;
    u32 jumpTarget, jumpPending;
};
struct DialogueState dialogue_state = {.magic = 0x50445753};
void dialogue_text_task(void *task, u32 *data);

static void release_scene(void) {
    if (dialogue_state.waiting && dialogue_state.scene)
        dialogue_state.scene[5] = dialogue_state.savedStep;
    dialogue_state.waiting = 0;
    dialogue_state.manager = 0;
    dialogue_state.scene = 0;
}
static void forget_task(void) {
    dialogue_state.task = 0;
    dialogue_state.data = 0;
}
static void close_page(void) {
    if (!dialogue_state.task) return;
    ((void (*)(u32 *))0x021a36f9)(dialogue_state.data);
    ((void (*)(void *))0x0203a89d)(dialogue_state.task);
    forget_task();
}
static void open_page(void *manager, u32 bank, u32 message, u32 duration,
                      u32 x, u32 y, u32 width, u32 height) {
    void *task = ((CreateTask)0x0203a8b5)((void *)((u32 *)manager)[8], dialogue_text_task, 0x28, 1);
    if (!task) { release_scene(); return; }
    u32 *data = ((TaskData)0x0203a93d)(task);
    dialogue_state.task = task;
    dialogue_state.data = data;
    dialogue_state.opened = 0;
    ((InitText)0x021a368d)(manager, data, bank, message, duration, x, y, width, height);
}
static void queue_jump(u32 *scene, u32 frame) {
    dialogue_state.jumpScene = scene;
    dialogue_state.jumpTarget = frame;
    dialogue_state.jumpPending = 1;
}
/* Called once per native update-loop iteration by the assembly bridge.
   Return the normal step, or a single accumulated delta and an exit-loop flag. */
uint64_t dialogue_scene_step(u32 *scene, u32 accumulated) {
    if (!dialogue_state.jumpPending || dialogue_state.jumpScene != scene)
        return scene[5];
    u32 target = dialogue_state.jumpTarget;
    u32 *camera = (u32 *)scene[0x18 / 4];
    u32 *manager = (u32 *)scene[0x7c / 4];
    int32_t *program = ((int32_t *(*)(u32))0x021a2c01)(scene[0x88 / 4]);
    u32 index = 0;
    while (index < 1023 && program[index * 10] != 19 && program[index * 10 + 1] < (int32_t)target) index++;
    manager[2] = program[index * 10] == 19;
    manager[4] = target - 1;
    manager[5] = index;
    dialogue_state.jumpPending = 0;
    u32 delta = (target << 12) - camera[4] - accumulated;
    return ((uint64_t)1 << 32) | delta;
}
void dialogue_cue(void *manager, void *scene, const int32_t *args) {
    u32 marker = (u32)args[2];
    if (marker < 0x50445700 || marker > 0x50445703) {
        ((Cue)0x021a3519)(manager, scene, args);
        return;
    }
    close_page();
    release_scene();
    if (marker == 0x50445702) { queue_jump(scene, (u32)args[1]); return; }
    dialogue_state.manager = manager;
    dialogue_state.mode = marker == 0x50445703;
    u32 duration = (u32)args[3];
    if ((marker & 1) || dialogue_state.mode) {
        dialogue_state.scene = scene;
        dialogue_state.savedStep = ((u32 *)scene)[5];
        dialogue_state.waiting = 1;
        dialogue_state.released = 0;
        ((u32 *)scene)[5] = 0;
        duration = 0x3fffffff;
    }
    if (dialogue_state.mode) {
        dialogue_state.choiceCount = (u32)args[3];
        dialogue_state.choiceIndex = 0;
        dialogue_state.firstMessage = (u32)args[1];
        dialogue_state.bank = (u32)args[0];
        for (u32 i = 0; i < 3; i++) dialogue_state.targets[i] = (u32)args[4 + i];
    }
    u32 *params = (u32 *)((u32 *)scene)[0x84 / 4];
    if (((uint16_t *)params)[3] & 1) duration *= 2;
    open_page(manager, (u32)args[0], (u32)args[1], duration,
        dialogue_state.mode ? 2 : (u32)args[4], dialogue_state.mode ? 11 : (u32)args[5],
        dialogue_state.mode ? 28 : (u32)args[6], dialogue_state.mode ? 12 : (u32)args[7]);
}
void dialogue_text_task(void *task, u32 *data) {
    Task original = (Task)0x021a35a9;
    if (data != dialogue_state.data) { original(task, data); return; }
    u32 *parent = (u32 *)data[0];
    if (parent[3]) { forget_task(); release_scene(); original(task, data); return; }
    if (data[1] == 0) {
        /* Signed -128 means 128 glyphs per update, enough for our single page. */
        uint8_t speed = ((uint8_t *)parent)[0x18];
        ((uint8_t *)parent)[0x18] = 0x80;
        original(task, data);
        ((uint8_t *)parent)[0x18] = speed;
        dialogue_state.opened = 1;
        return;
    }
    if (!dialogue_state.waiting) {
        if (data[2] >= data[3]) { forget_task(); release_scene(); }
        original(task, data);
        return;
    }
    /* Skipped simulation iterations share one physical input edge. */
    if (((uint8_t *)parent)[0x1a]) return;
    u32 pressed = ((Keys)0x0203df29)();
    if (dialogue_state.mode && (pressed & 0xc0)) {
        u32 next = dialogue_state.choiceIndex;
        if (pressed & 0x80) next = next + 1 == dialogue_state.choiceCount ? 0 : next + 1;
        else next = next == 0 ? dialogue_state.choiceCount - 1 : next - 1;
        dialogue_state.choiceIndex = next;
        close_page();
        open_page(parent, dialogue_state.bank, dialogue_state.firstMessage + next, 0x7ffffffe, 2, 11, 28, 12);
        return;
    }
    u32 held = ((Keys)0x0203df4d)();
    if (!(held & 3)) dialogue_state.released = 1;
    if (dialogue_state.opened && dialogue_state.released && (pressed & (dialogue_state.mode ? 1 : 3))) {
        /* A fresh press cannot dismiss a page before its font update finishes. */
        if (data[8] && *((u32 *)data[8]) != 2) return;
        if (dialogue_state.mode) {
            u32 *scene = dialogue_state.scene, target = dialogue_state.targets[dialogue_state.choiceIndex];
            close_page();
            release_scene();
            queue_jump(scene, target);
            return;
        }
        data[2] = data[3];
        forget_task();
        release_scene();
        original(task, data);
    }
}
