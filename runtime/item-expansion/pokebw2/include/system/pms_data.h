#ifndef POKEBW2_SYSTEM_PMS_DATA_H
#define POKEBW2_SYSTEM_PMS_DATA_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "struct_decls.h"

// Sentences (pms_data.c, a guessed name): a sentence from one of the message files of sentence types, with up to two
// words filled into its word set commands, as trainers' greetings and the mail use them

// The sentence types, the message file each one's sentences are in
#define PMS_SENTENCE_TYPE_COUNT 7
// Up to two words fill a sentence
#define PMS_SENTENCE_WORD_MAX 2

struct PMSData {
    // PMS_WORD_NULL when the sentence is empty
    u16 type;
    u16 id;
    u16 words[PMS_SENTENCE_WORD_MAX];
};

void PMSData_Clear(PMSData *data);
void PMSData_Init(PMSData *data, u16 type);
void PMSData_InitWithSentence(PMSData *data, u16 type, u16 id);
// One of four fixed sentences
void PMSData_InitPreset(PMSData *data, u32 preset);
void PMSData_InitGreeting(PMSData *data);
StrBuf *PMSData_ToString(const PMSData *data, u32 heapId);
// The sentence with its first wordCount words filled in
StrBuf *PMSData_ToStringWithWords(const PMSData *data, u32 heapId, int wordCount);
// The sentence without its words filled in
StrBuf *PMSData_GetSentenceString(const PMSData *data, u32 heapId);
BOOL PMSData_IsNotEmpty(const PMSData *data);
// Whether every word the sentence has a command for is filled in
BOOL PMSData_IsComplete(const PMSData *data, HeapID heapId);
u16 PMSData_GetWordIndex(const PMSData *data, u32 index);
u16 PMSData_GetWord(const PMSData *data, u32 index);
BOOL PMSData_IsWordNumber(const PMSData *data, u32 index);
BOOL PMSWord_IsNumber(u16 word);
int PMSWord_GetNumber(u16 word);
u16 PMSData_GetType(const PMSData *data);
u16 PMSData_GetID(const PMSData *data);
BOOL PMSData_Equals(const PMSData *data, const PMSData *other);
void PMSData_Copy(PMSData *dest, const PMSData *src);
// The number of sentences of a type
u32 PMSData_GetSentenceCount(u32 type);
void PMSData_SetSentence(PMSData *data, u32 type, u32 id);
void PMSData_SetWord(PMSData *data, u32 index, u16 word);
// Empties the words the sentence has no command for
void PMSData_ClearUnusedWords(PMSData *data, HeapID heapId);
BOOL PMSData_IsValid(const PMSData *data, u32 heapId);
// Replaces an invalid sentence or word with a default one, and returns whether all of it was valid
BOOL PMSData_Validate(PMSData *data, BOOL allowEmpty, HeapID heapId);
BOOL PMSWord_Validate(u16 *word, BOOL allowEmpty, BOOL allowNumber);
BOOL PMSNumber_Validate(int *number, BOOL allowZero);

#endif // POKEBW2_SYSTEM_PMS_DATA_H
