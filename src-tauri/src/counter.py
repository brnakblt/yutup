import sys

import os

# Use a path relative to the script's location
script_dir = os.path.dirname(os.path.abspath(__file__))
lib_rs_path = os.path.join(script_dir, 'lib.rs')

with open(lib_rs_path, 'r', encoding='utf-8') as f:
    content = f.read()

brace_count = 0
bracket_count = 0
paren_count = 0

for i, char in enumerate(content):
    if char == '{': brace_count += 1
    elif char == '}': brace_count -= 1
    elif char == '[': bracket_count += 1
    elif char == ']': bracket_count -= 1
    elif char == '(': paren_count += 1
    elif char == ')': paren_count -= 1
    
    if brace_count < 0: print(f"Negative brace count at index {i}")
    if bracket_count < 0: print(f"Negative bracket count at index {i}")
    if paren_count < 0: print(f"Negative paren count at index {i}")

print(f"Final counts: Braces={brace_count}, Brackets={bracket_count}, Parens={paren_count}")
