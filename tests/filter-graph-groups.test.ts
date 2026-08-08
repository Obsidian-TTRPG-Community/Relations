import { describe, it, expect } from 'vitest';
import { filterGraphByGroups } from '../src/graph';
import type {
  GraphEdge,
  GraphNode,
  RelationsGraph,
  RelationshipType,
} from '../src/types';

/**
 * Tests for filterGraphByGroups — the group-based filter for code-block embeds.
 * Filters edges by relationship type group membership: strict match, so ungrouped
 * types are excluded once a filter is active. Removes any node left with no
 * remaining edges (except an optional keepNodeId).
 */

function node(id: string): GraphNode {
  return { id, label: id, tags: [], image: null };
}

function edge(source: string, target: string, type: string): GraphEdge {
  return {
    source,
    target,
    type,
    color: '#888',
    symmetric: true,
    pair: false,
    lineStyle: 'solid',
    genealogy: false,
  };
}

function relationType(name: string, group?: string): RelationshipType {
  return {
    name,
    color: '#888',
    symmetric: true,
    pair: false,
    treeLayout: false,
    lineStyle: 'solid',
    genealogy: false,
    group,
  };
}

describe('filterGraphByGroups', () => {
  it('returns the original graph reference when enabledGroups is empty', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B')],
      edges: [edge('A', 'B', 'friend')],
    };
    const types = [relationType('friend', 'Social')];
    const out = filterGraphByGroups(graph, new Set(), undefined, types);
    expect(out).toBe(graph);
  });

  it('filters edges by type group membership', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C'), node('D')],
      edges: [
        edge('A', 'B', 'friend'), // Social group
        edge('B', 'C', 'enemy'), // Conflict group
        edge('C', 'D', 'mentor'), // Education group
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('enemy', 'Conflict'),
      relationType('mentor', 'Education'),
    ];
    const out = filterGraphByGroups(
      graph,
      new Set(['Social']),
      undefined,
      types
    );
    expect(out.edges.map((e) => e.type)).toEqual(['friend']);
  });

  it('excludes ungrouped types once a groups filter is active', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [
        edge('A', 'B', 'friend'), // Social group
        edge('B', 'C', 'mentor'), // No group (ungrouped)
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('mentor'), // No group
    ];
    const out = filterGraphByGroups(
      graph,
      new Set(['Social']),
      undefined,
      types
    );
    expect(out.edges.map((e) => e.type)).toEqual(['friend']);
  });

  it('handles multiple groups with OR logic', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C'), node('D'), node('E')],
      edges: [
        edge('A', 'B', 'friend'), // Social
        edge('B', 'C', 'ally'), // Social
        edge('C', 'D', 'enemy'), // Conflict
        edge('D', 'E', 'mentor'), // Education
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('ally', 'Social'),
      relationType('enemy', 'Conflict'),
      relationType('mentor', 'Education'),
    ];
    const out = filterGraphByGroups(
      graph,
      new Set(['Social', 'Conflict']),
      undefined,
      types
    );
    expect(out.edges.map((e) => e.type).sort()).toEqual([
      'ally',
      'enemy',
      'friend',
    ]);
  });

  it('prunes nodes left with no remaining edges', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C'), node('D')],
      edges: [
        edge('A', 'B', 'friend'), // Social (kept)
        edge('B', 'C', 'enemy'), // Conflict (removed)
        edge('C', 'D', 'mentor'), // Education (removed)
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('enemy', 'Conflict'),
      relationType('mentor', 'Education'),
    ];
    const out = filterGraphByGroups(
      graph,
      new Set(['Social']),
      undefined,
      types
    );
    // Only A and B are still connected via friend edge
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(out.edges.length).toBe(1);
  });

  it('retains keepNodeId even when it becomes isolated', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [
        edge('A', 'B', 'friend'), // Social
        edge('B', 'C', 'enemy'), // Conflict
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('enemy', 'Conflict'),
    ];
    // Filter to only Social group, A is the center
    const out = filterGraphByGroups(graph, new Set(['Social']), 'A', types);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(out.edges.length).toBe(1);
  });

  it('retains keepNodeId even when no edges remain', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B')],
      edges: [edge('A', 'B', 'enemy')], // Conflict
    };
    const types = [relationType('enemy', 'Conflict')];
    // Filter to Social group (doesn't exist), A is the center
    const out = filterGraphByGroups(graph, new Set(['Social']), 'A', types);
    expect(out.nodes.map((n) => n.id)).toEqual(['A']);
    expect(out.edges.length).toBe(0);
  });

  it('handles types not in the relationshipTypes array', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [
        edge('A', 'B', 'friend'), // In types
        edge('B', 'C', 'unknown'), // NOT in types
      ],
    };
    const types = [relationType('friend', 'Social')];
    // Unknown type should be included (safe default)
    const out = filterGraphByGroups(
      graph,
      new Set(['Social']),
      undefined,
      types
    );
    expect(out.edges.length).toBe(2);
  });

  it('handles empty relationshipTypes array', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B')],
      edges: [edge('A', 'B', 'friend')],
    };
    // With no types defined, all edges are included as default (safe)
    const out = filterGraphByGroups(graph, new Set(['Social']), undefined, []);
    expect(out.edges.length).toBe(1);
  });

  it('does not mutate the input graph', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B', 'friend'), edge('B', 'C', 'enemy')],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('enemy', 'Conflict'),
    ];
    filterGraphByGroups(graph, new Set(['Social']), undefined, types);
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBe(2);
  });

  it('filters complex multi-group scenario', () => {
    const graph: RelationsGraph = {
      nodes: [node('A'), node('B'), node('C'), node('D'), node('E'), node('F')],
      edges: [
        edge('A', 'B', 'friend'), // Social
        edge('B', 'C', 'spouse'), // Romance
        edge('C', 'D', 'enemy'), // Conflict
        edge('D', 'E', 'mentor'), // (ungrouped)
        edge('E', 'F', 'ally'), // Social
      ],
    };
    const types = [
      relationType('friend', 'Social'),
      relationType('spouse', 'Romance'),
      relationType('enemy', 'Conflict'),
      relationType('mentor'), // No group
      relationType('ally', 'Social'),
    ];
    // Show Social and Romance groups
    const out = filterGraphByGroups(
      graph,
      new Set(['Social', 'Romance']),
      undefined,
      types
    );
    // Should have: friend (A-B), spouse (B-C), ally (E-F)
    // Should NOT have: enemy (C-D, wrong group), mentor (D-E, ungrouped)
    expect(out.edges.map((e) => e.type).sort()).toEqual([
      'ally',
      'friend',
      'spouse',
    ]);
  });
});
