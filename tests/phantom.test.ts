import { describe, it, expect, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { buildFullGraph } from '../src/graph';
import type { RelationsSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

function makeTFile(path: string, basename: string): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = basename;
  return file;
}

/**
 * Mock App and Vault for testing phantom node creation
 */
class MockMetadataCache {
  private files: Map<string, TFile> = new Map();
  private frontmatterByPath: Map<string, Record<string, unknown>> = new Map();

  addFile(path: string, basename: string, frontmatter?: Record<string, unknown>) {
    this.files.set(path, makeTFile(path, basename));
    if (frontmatter) this.frontmatterByPath.set(path, frontmatter);
  }

  getFirstLinkpathDest(linkTarget: string, contextPath: string): TFile | null {
    // Case-insensitive lookup, matching Obsidian's real resolver
    const normalized = linkTarget.toLowerCase();
    for (const file of this.files.values()) {
      if (file.basename.toLowerCase() === normalized) {
        return file;
      }
    }
    return null; // Unresolved link
  }

  getFileCache(file: { path: string }) {
    const frontmatter = this.frontmatterByPath.get(file.path);
    return frontmatter ? { frontmatter } : null;
  }
}

class MockVault {
  private files: Map<string, TFile> = new Map();

  addFile(path: string, basename: string) {
    this.files.set(path, makeTFile(path, basename));
  }

  getMarkdownFiles() {
    return Array.from(this.files.values());
  }

  getAbstractFileByPath(path: string) {
    return this.files.get(path) ?? null;
  }

  getResourcePath() {
    return 'app://image-resource';
  }
}

class MockApp {
  metadataCache: MockMetadataCache;
  vault: MockVault;

  constructor() {
    this.metadataCache = new MockMetadataCache();
    this.vault = new MockVault();
  }
}

function addNote(
  app: MockApp,
  path: string,
  basename: string,
  frontmatter?: Record<string, unknown>
) {
  app.vault.addFile(path, basename);
  app.metadataCache.addFile(path, basename, frontmatter);
}

describe('Phantom Nodes', () => {
  let app: MockApp;
  let settings: RelationsSettings;

  beforeEach(() => {
    app = new MockApp();
    // Registered directly in the vault (not via addNote) so resolvePlaceholderImage's
    // literal-vault-path fallback can find it, mirroring a real image attachment.
    app.vault.addFile('z_Assets/Placeholder_Person.png', 'Placeholder_Person.png');
    settings = {
      ...DEFAULT_SETTINGS,
      phantomPlaceholderImage: 'z_Assets/Placeholder_Person.png',
    };
  });

  describe('Phantom node creation', () => {
    it('creates phantom node for unresolved reference', () => {
      // Alice references Bob, who has no matching file
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      // Should have 2 nodes: Alice (real) and Bob (phantom)
      expect(graph.nodes).toHaveLength(2);

      // Phantom node id is the raw link text, not lowercased — it's what a
      // click on the node should try to open/create.
      const bobNode = graph.nodes.find((n) => n.id === 'Bob');
      expect(bobNode).toBeDefined();
      expect(bobNode?.isPhantom).toBe(true);
      expect(bobNode?.label).toBe('Bob');
    });

    it('marks real nodes as not phantom', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      const aliceNode = graph.nodes.find((n) => n.id === 'People/Alice.md');
      expect(aliceNode).toBeDefined();
      expect(aliceNode?.isPhantom).toBe(undefined); // Real nodes don't set isPhantom
    });

    it('assigns placeholder image to phantom nodes', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      const phantomNode = graph.nodes.find((n) => n.isPhantom);
      expect(phantomNode).toBeDefined();
      expect(phantomNode?.image).toBe('app://image-resource');
    });

    it('handles multiple phantom nodes from same note', () => {
      addNote(app, 'People/Alice.md', 'Alice', {
        ally: '[[Bob]]',
        enemy: '[[Charlie]]',
      });

      const graph = buildFullGraph(app as any, settings).graph;

      // Count phantom nodes
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);

      // All phantom nodes should have the placeholder image
      phantomNodes.forEach((node) => {
        expect(node.image).toBe('app://image-resource');
      });
    });

    it('creates edges to phantom nodes', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      // Should have at least one edge
      expect(graph.edges.length).toBeGreaterThan(0);

      // Edge should reference the phantom node
      const phantomEdges = graph.edges.filter((e) => e.target === 'Bob');
      expect(phantomEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phantom node placeholders', () => {
    it('uses configured placeholder image path', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const customSettings = {
        ...settings,
        phantomPlaceholderImage: 'custom/path/fallback.png',
      };

      const graph = buildFullGraph(app as any, customSettings).graph;
      const phantomNode = graph.nodes.find((n) => n.isPhantom);

      // Should attempt to resolve the custom path
      expect(phantomNode?.image).toBeDefined();
    });

    it('handles missing placeholder image gracefully', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const customSettings = {
        ...settings,
        phantomPlaceholderImage: '', // Empty path
      };

      const graph = buildFullGraph(app as any, customSettings).graph;
      const phantomNode = graph.nodes.find((n) => n.isPhantom);

      // Should still create the phantom node, just without an image
      expect(phantomNode).toBeDefined();
      expect(phantomNode?.image).toBeNull();
    });
  });

  describe('Phantom nodes with display names', () => {
    it('preserves display name from aliased links', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob|Bobby]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);

      // Phantom node id stays the raw target; label uses the alias
      const bobNode = graph.nodes.find((n) => n.id === 'Bob');
      expect(bobNode?.label).toBe('Bobby');
    });

    it('phantom node id preserves the raw link text (not lowercased)', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[BOB the Bold]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      const phantomNode = graph.nodes.find((n) => n.isPhantom);
      expect(phantomNode?.id).toBe('BOB the Bold');
    });

    it('a phantom child declared via a declaresChild property still stores child->parent', () => {
      const childrenType = {
        name: 'children',
        color: '#b45309',
        symmetric: false,
        pair: false,
        treeLayout: true,
        lineStyle: 'solid' as const,
        genealogy: true,
        declaresChild: true,
      };
      addNote(app, 'People/Alice.md', 'Alice', { children: '[[Bob]]' });
      const withChildrenType = {
        ...settings,
        relationshipTypes: [...settings.relationshipTypes, childrenType],
      };

      const graph = buildFullGraph(app as any, withChildrenType).graph;

      // Alice (parent, real) declares Bob (child, phantom) via `children:` —
      // the edge should still be swapped to child->parent, same as a real file.
      const edge = graph.edges.find((e) => e.type === 'children');
      expect(edge?.source).toBe('Bob');
      expect(edge?.target).toBe('People/Alice.md');
    });
  });

  describe('Phantom nodes edge integration', () => {
    it("phantom nodes don't get filtered out by edge dedup", () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);
      const phantomId = phantomNodes[0].id;
      const edgesToPhantom = graph.edges.filter((e) => e.target === phantomId);
      expect(edgesToPhantom.length).toBeGreaterThanOrEqual(1);
    });

    it('phantom node edges have required properties', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });

      const graph = buildFullGraph(app as any, settings).graph;

      graph.edges.forEach((edge) => {
        expect(edge.source).toBeDefined();
        expect(edge.target).toBeDefined();
        expect(edge.type).toBeDefined();
        expect(edge.color).toBeDefined();
      });
    });
  });

  describe('Phantom nodes in different modes', () => {
    it('phantom nodes work with empty vault', () => {
      const graph = buildFullGraph(app as any, settings).graph;
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('phantom nodes coexist with real nodes', () => {
      addNote(app, 'People/Alice.md', 'Alice', { ally: '[[Bob]]' });
      addNote(app, 'People/Charlie.md', 'Charlie');

      const graph = buildFullGraph(app as any, settings).graph;

      const realNodes = graph.nodes.filter(
        (n) => !n.isPhantom && n.id.endsWith('.md')
      );
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);

      expect(realNodes.length).toBeGreaterThanOrEqual(1);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);
      expect(phantomNodes.every((n) => n.isPhantom)).toBe(true);
    });
  });
});
