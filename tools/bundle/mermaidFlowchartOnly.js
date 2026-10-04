/** 静的 import を保護し、mermaid 内の動的 import だけを許可リストで絞る。 */
function shouldIgnoreMermaidImport(resource, context, dependencyType) {
  if (
    dependencyType !== 'import()' ||
    !/(?:^|\/)node_modules\/mermaid\/dist(?:\/|$)/.test(context.replace(/\\/g, '/'))
  ) {
    return false;
  }
  if (resource === 'katex') {
    return true;
  }
  if (!/^\.\/(?:chunks\/mermaid\.core\/)?[^/]+\.mjs$/.test(resource)) {
    return false;
  }
  return !/\/(?:chunk-|flowDiagram-|dagre-)[^/]+\.mjs$/.test(resource);
}

module.exports = { shouldIgnoreMermaidImport };
