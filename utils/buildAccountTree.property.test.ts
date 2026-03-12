import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildAccountTree } from './buildAccountTree'
import type { AccountTreeItem } from '../types/ui'

/**
 * Arbitrary: generates a single account segment (non-empty, no colons).
 * Uses lowercase alpha strings to keep things readable.
 */
const accountSegment = fc.stringMatching(/^[a-z]{1,8}$/)

/**
 * Arbitrary: generates a colon-separated account path with 1–4 segments.
 */
const accountPath = fc.array(accountSegment, { minLength: 1, maxLength: 4 }).map(parts => parts.join(':'))

/**
 * Arbitrary: generates a non-empty array of unique account paths.
 */
const accountPaths = fc.uniqueArray(accountPath, { minLength: 1, maxLength: 20 })

/** Collect all nodes in the tree via DFS */
function collectAllNodes(tree: AccountTreeItem[]): AccountTreeItem[] {
  const result: AccountTreeItem[] = []
  const stack = [...tree]
  while (stack.length) {
    const node = stack.pop()!
    result.push(node)
    if (node.children?.length) {
      stack.push(...node.children)
    }
  }
  return result
}

/** Get all ancestor paths for a colon-separated path */
function getAncestors(path: string): string[] {
  const parts = path.split(':')
  const ancestors: string[] = []
  for (let i = 1; i <= parts.length; i++) {
    ancestors.push(parts.slice(0, i).join(':'))
  }
  return ancestors
}

describe('buildAccountTree — Property Tests', () => {
  /**
   * Property 1: Account tree preserves hierarchy and creates implicit parents
   *
   * For any set of colon-separated account paths, buildAccountTree shall produce a tree where
   * every account path in the input has a corresponding node, all intermediate ancestor nodes
   * are created even if not in the input, and each node's fullName equals the colon-joined
   * path from root to that node.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it('Property 1: preserves hierarchy and creates implicit parents', () => {
    fc.assert(
      fc.property(accountPaths, (paths) => {
        const tree = buildAccountTree(paths)
        const allNodes = collectAllNodes(tree)
        const nodesByFullName = new Map(allNodes.map(n => [n.fullName, n]))

        // Every input path must have a corresponding node
        for (const path of paths) {
          expect(nodesByFullName.has(path)).toBe(true)
        }

        // All intermediate ancestors must exist as nodes
        for (const path of paths) {
          for (const ancestor of getAncestors(path)) {
            expect(nodesByFullName.has(ancestor)).toBe(true)
          }
        }

        // Each node's fullName must equal the colon-joined path from root to that node
        for (const node of allNodes) {
          const parts = node.fullName.split(':')
          expect(node.label).toBe(parts[parts.length - 1])

          // Verify parent-child relationship: if node has a parent path, it must be a child of that parent
          if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join(':')
            const parentNode = nodesByFullName.get(parentPath)
            expect(parentNode).toBeDefined()
            expect(parentNode!.children!.some(c => c.fullName === node.fullName)).toBe(true)
          }
        }
      }),
    )
  })

  /**
   * Property 2: Account tree children are sorted alphabetically
   *
   * For any set of colon-separated account paths, at every level of the tree returned by
   * buildAccountTree, the children array is sorted alphabetically by label.
   *
   * **Validates: Requirement 3.3**
   */
  it('Property 2: children sorted alphabetically at every level', () => {
    fc.assert(
      fc.property(accountPaths, (paths) => {
        const tree = buildAccountTree(paths)

        function assertSorted(nodes: AccountTreeItem[]) {
          for (let i = 1; i < nodes.length; i++) {
            expect(nodes[i - 1]!.label.localeCompare(nodes[i]!.label)).toBeLessThanOrEqual(0)
          }
          for (const node of nodes) {
            if (node.children?.length) {
              assertSorted(node.children)
            }
          }
        }

        assertSorted(tree)
      }),
    )
  })

  /**
   * Property 3: Account tree top-level nodes are default-expanded
   *
   * For any set of colon-separated account paths, every top-level node in the tree returned
   * by buildAccountTree has defaultExpanded set to true.
   *
   * **Validates: Requirement 3.4**
   */
  it('Property 3: top-level nodes have defaultExpanded set to true', () => {
    fc.assert(
      fc.property(accountPaths, (paths) => {
        const tree = buildAccountTree(paths)

        for (const root of tree) {
          expect(root.defaultExpanded).toBe(true)
        }
      }),
    )
  })
})
