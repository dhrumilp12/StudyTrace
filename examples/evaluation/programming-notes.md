# Python containers
A Python list is an ordered mutable sequence that can contain repeated values.
A Python tuple is an ordered immutable sequence, although a contained object can itself be mutable.
A Python dictionary stores key-value pairs and requires hashable keys.
A set stores distinct hashable elements and does not preserve a meaningful positional index.
# References and copying
Assignment binds a name to an object rather than automatically copying that object.
A shallow copy creates a new outer container but retains references to nested objects.
A deep copy recursively copies nested objects, subject to the object's custom copy behavior.
The expression b = a makes both names refer to the same list when a already refers to a list.
```python
a = [[1], [2]]
b = a.copy()
b[0].append(3)
```
The original a now contains [1, 3] in its first inner list because the shallow copy shares that inner list.
# Exceptions
A finally clause runs when control leaves a try statement, including during a return or raised exception.
An except clause handles only exceptions matched by its specified exception type or types.
Catching every exception can hide defects and make unexpected failures harder to diagnose.
# Complexity and testing
A linear search may inspect every element and has worst-case time complexity O(n).
Binary search requires sorted input and has logarithmic time complexity O(log n) for random-access sequences.
A passing unit test establishes behavior only for the checked input and assertions.
A regression test preserves an example of a previously observed defect after the fix.
