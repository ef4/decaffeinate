import Scope from './Scope';
import buildLineAndColumnMap from './buildLineAndColumnMap';
import findCounterpartCharacter from './findCounterpartCharacter';
import traverse from './traverse';
import { parse as coffeeScriptParse } from 'coffee-script-redux';

/**
 * Parses a CoffeeScript program and cleans up and annotates the AST.
 *
 * @param {string} source
 * @returns {Object} An AST from CoffeeScriptRedux with `scope` and `parent`.
 */
export default function parse(source) {
  const ast = coffeeScriptParse(source, { raw: true }).toBasicObject();
  const map = buildLineAndColumnMap(source);

  traverse(ast, function(node) {
    attachScope(node);
    fixRange(node, map, source);
  });

  return ast;
}

/**
 * @param {Object} node
 * @private
 */
function attachScope(node) {
  switch (node.type) {
    case 'Program':
      node.scope = new Scope();
      break;

    case 'Function':
    case 'BoundFunction':
      node.scope = new Scope(node.parent.scope);
      break;

    default:
      node.scope = node.parent.scope;
      break;
  }

  node.scope.processNode(node);
}

/**
 * @param {Object} node
 * @param {LineAndColumnMap} map
 * @param {string} source
 * @private
 */
function fixRange(node, map, source) {
  if (!node.range && node.type === 'ConcatOp') { return; }

  if (!('raw' in node)) {
    if (node.parent && node.parent.type === 'While' && node.parent.condition === node) {
      // Ignore `while` condition without raw
      return;
    } else if (node.type === 'LogicalNotOp' && node.parent.type === 'Conditional' && node.parent.condition === node) {
      node.raw = node.expression.raw;
      node.range = node.expression.range;
      node.line = node.expression.line;
      node.column = node.expression.column;
    } else if (node.left && node.right) {
      // binary operators don't seem to come with a .raw, but we can
      // figure it out based on their left and right children.
      node.raw = source.slice(node.left.range[0], node.right.range[1]);
      node.range = [node.left.range[0], node.right.range[1]];
      node.line = node.left.line;
      node.column = node.left.column;
    } else {
      throw new Error(
        'BUG! Could not fix range for ' + node.type +
        ' because it has no raw value'
      );
    }
  }
  const fixed = map.getOffset(node.line - 1, node.column - 1);
  for (var slide = 0; slide < 3; slide++) {
    if (source.slice(fixed - slide, fixed - slide + node.raw.length) === node.raw) {
      node.range = [fixed - slide, fixed - slide + node.raw.length];
      break;
    }
  }

  if (!node.range || node.raw !== source.slice(node.range[0], node.range[1])) {
    if (node.parent && node.parent.step === node) {
      // Ignore invalid `step` parameters, they're auto-generated if left out.
      return;
    }

    if (shrinkPastParentheses(node, map, source, false)) {
      return;
    }

    throw new Error(
      'BUG! Could not fix range for ' + node.type +
      ' at line ' + node.line + ', column ' + node.column
    );
  } else {
    shrinkPastParentheses(node, map, source, true);
  }
}

/**
 * Work around a bug with parentheses.
 *
 * Sometimes parentheses end up as part of a node's raw value even though they
 * probably shouldn't, like with `if (ref = a) then b else c`, the node for the
 * assignment has a raw value of "(ref = a)".
 *
 * @param {Object} node
 * @param {LineAndColumnMap} map
 * @param {string} source
 * @param {boolean} adjustPosition
 * @returns {boolean}
 */
function shrinkPastParentheses(node, map, source, adjustPosition) {
  if (node.raw[0] === '(') {
    let counterpart = findCounterpartCharacter('(', node.raw);
    if (counterpart === node.raw.length - 1) {
      node.raw = node.raw.slice(1, -1);
      if (adjustPosition) {
        node.range = [node.range[0] + 1, node.range[1] - 1];
        node.column -= 1;
      }
      fixRange(node, map, source);
      return true;
    }
  }

  return false;
}
