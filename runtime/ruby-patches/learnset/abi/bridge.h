#pragma once
#include <stddef.h>

// Field access is an ABI primitive: the frontend uses the same syntax for
// references and pointers. C++ verifies the concrete record/field types.
template<class T> inline T& rb_object(T& value) { return value; }
template<class T> inline T& rb_object(T* value) { return *value; }
