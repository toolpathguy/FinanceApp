import type { AccountTreeItem } from '../types/ui'

/**
 * Converts a flat array of colon-separated account paths into a tree
 * of AccountTreeItem nodes compatible with Nuxt UI UTree.
 *
 * - Creates implicit parent nodes for intermediate path segments
 * - Sorts children alphabetically by label at every level
 * - Sets defaultExpanded on top-level nodes
 */
export function buildAccountTree(accounts: string[]): AccountTreeItem[] {
  const roots: AccountTreeItem[] = []
  const nodeMap = new Map<string, AccountTreeItem>()
  const sorted = [...accounts].sort()

  for (const fullName of sorted) {
    const parts = fullName.split(':')
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const parentPath = currentPath
      currentPath = currentPath ? `${currentPath}:${part}` : part

      if (!nodeMap.has(currentPath)) {
        const node: AccountTreeItem = {
          label: part,
          fullName: currentPath,
          children: [],
        }
        nodeMap.set(currentPath, node)

        if (parentPath && nodeMap.has(parentPath)) {
          nodeMap.get(parentPath)!.children!.push(node)
        } else if (!parentPath) {
          node.defaultExpanded = true
          roots.push(node)
        }
      }
    }
  }

  const sortChildren = (nodes: AccountTreeItem[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label))
    nodes.forEach((n) => {
      if (n.children?.length) {
        sortChildren(n.children)
      } else {
        delete n.children
      }
    })
  }
  sortChildren(roots)

  return roots
}
