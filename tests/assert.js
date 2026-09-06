export function assert(condition, message = 'Assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function equal(actual, expected, message = 'Unexpected value') {
    const canonical = value => JSON.stringify(value, (_key, item) => {
        if (item && typeof item === 'object' && !Array.isArray(item))
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
        return item;
    });
    if (canonical(actual) !== canonical(expected))
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function rejects(callback, pattern) {
    let caught;
    try {
        await callback();
    } catch (error) {
        caught = error;
    }
    assert(caught, 'Expected an error');
    assert(pattern.test(caught.message), `Unexpected error: ${caught.message}`);
}
