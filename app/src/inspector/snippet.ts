/**
 * Silent-execution snippet for the variable inspector. Prints exactly one
 * line to stdout: the marker `__ORBITAL_VARS__` followed by a JSON array of
 * variable descriptors (see `parse.ts` for the shape it produces).
 *
 * Never raises: every per-variable inspection is wrapped in try/except and
 * skipped on failure. Only `json` and `sys` are imported, and only inside the
 * snippet's own function scope, which is defined and immediately invoked
 * then `del`eted so it leaves no names behind in the kernel's globals.
 */
export const INSPECT_SNIPPET = `
def __orbital_inspect():
    import json
    import sys

    _skip_prefixes = ('_', 'In', 'Out', 'exit', 'quit', 'get_ipython')
    _items = []
    for _name, _value in list(globals().items()):
        if _name.startswith(_skip_prefixes):
            continue
        try:
            _module = type(_value).__module__
        except Exception:
            _module = None
        if isinstance(_module, str) and _module.startswith('IPython'):
            continue
        try:
            _item = {}
            _item['name'] = _name
            _item['type'] = type(_value).__name__
            _item['module'] = _module if isinstance(_module, str) else None

            _shape = None
            try:
                _s = getattr(_value, 'shape', None)
                if isinstance(_s, tuple):
                    _shape = list(_s)
            except Exception:
                _shape = None
            _item['shape'] = _shape

            _length = None
            try:
                if hasattr(_value, '__len__') and not isinstance(_value, str):
                    _length = len(_value)
            except Exception:
                _length = None
            _item['length'] = _length

            try:
                _repr = repr(_value)
            except Exception:
                _repr = '<repr failed>'
            _item['repr'] = _repr.replace('\\n', ' ')[:80]

            try:
                _item['size'] = sys.getsizeof(_value)
            except Exception:
                _item['size'] = None

            _items.append(_item)
        except Exception:
            continue

    _items.sort(key=lambda _v: _v['name'])
    print('__ORBITAL_VARS__ ' + json.dumps(_items))

__orbital_inspect()
del __orbital_inspect
`;
