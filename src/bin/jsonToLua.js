function jsonToLua(json) {
  function convert(obj, indentLevel) {
    const indent = '  '.repeat(indentLevel);
    let lua = '';

    if (Array.isArray(obj)) {
      lua += '{\n';
      obj.forEach((item, index) => {
        lua += `${indent}  ${convert(item, indentLevel + 1)}`;
        if (index < obj.length - 1) {
          lua += ',\n';
        }
      });
      lua += `\n${indent}}`;
    } else if (typeof obj === 'object' && obj !== null) {
      lua += '{\n';
      const keys = Object.keys(obj);
      keys.forEach((key, index) => {
        lua += `${indent}  ["${key}"] = ${convert(obj[key], indentLevel + 1)}`;
        if (index < keys.length - 1) {
          lua += ',\n';
        }
      });
      lua += `\n${indent}}`;
    } else if (typeof obj === 'string') {
      lua += `"${obj}"`;
    } else if (typeof obj === 'number' || typeof obj === 'boolean') {
      lua += obj;
    } else {
      lua += 'nil';
    }

    return lua;
  }

  return `return ${convert(json, 0)}`;
}

module.exports = jsonToLua;