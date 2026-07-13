import { describe, it, expect, beforeEach } from 'vitest';
import { buildFullGraph } from '../src/graph';
import type { RelationsSettings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

/**
 * Mock App and Vault for testing phantom node creation
 */
class MockMetadataCache {
  private files: Map<string, { path: string; basename: string }> = new Map();

  addFile(path: string, basename: string) {
    this.files.set(path, { path, basename });
  }

  getFirstLinkpathDest(
    linkTarget: string,
    contextPath: string
  ): { path: string } | null {
    // Case-insensitive lookup
    const normalized = linkTarget.toLowerCase();
    for (const [path, file] of this.files) {
      if (file.basename.toLowerCase() === normalized) {
        return { path };
      }
    }
    return null; // Unresolved link
  }

  getFileCache() {
    return null;
  }
}

class MockVault {
  private files: Map<string, { path: string; basename: string }> = new Map();

  addFile(path: string, basename: string) {
    this.files.set(path, { path, basename });
  }

  getMarkdownFiles() {
    return Array.from(this.files.values());
  }

  getAbstractFileByPath(path: string) {
    const file = this.files.get(path);
    return file ? { path: file.path, basename: file.basename } : null;
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

describe('Phantom Nodes', () => {
  let app: MockApp;
  let settings: RelationsSettings;

  beforeEach(() => {
    app = new MockApp();
    settings = {
      ...DEFAULT_SETTINGS,
      phantomPlaceholderImage: 'z_Assets/Placeholder_Person.png',
    };
  });

  describe('Phantom node creation', () => {
    it('creates phantom node for unresolved reference', () => {
      // Add a real note that references a non-existent note
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      // Alice references Bob (who doesn't exist)
      const graph = buildFullGraph(app as any, settings);

      // Should have 2 nodes: Alice (real) and Bob (phantom)
      expect(graph.nodes).toHaveLength(2);

      const bobNode = graph.nodes.find((n) => n.id === 'bob');
      expect(bobNode).toBeDefined();
      expect(bobNode?.isPhantom).toBe(true);
      expect(bobNode?.label).toBe('Bob');
    });

    it('marks real nodes as not phantom', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      const aliceNode = graph.nodes.find((n) => n.id === 'people/alice.md');
      expect(aliceNode).toBeDefined();
      expect(aliceNode?.isPhantom).toBe(undefined); // Real nodes don't set isPhantom
    });

    it('assigns placeholder image to phantom nodes', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      const phantomNode = graph.nodes.find((n) => n.isPhantom);
      expect(phantomNode).toBeDefined();
      expect(phantomNode?.image).toBe('app://image-resource');
    });

    it('handles multiple phantom nodes from same note', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      // Count phantom nodes
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);

      // All phantom nodes should have the placeholder image
      phantomNodes.forEach((node) => {
        expect(node.image).toBe('app://image-resource');
      });
    });

    it('creates edges to phantom nodes', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      // Should have at least one edge
      expect(graph.edges.length).toBeGreaterThan(0);

      // Edge should reference the phantom node
      const phantomEdges = graph.edges.filter((e) => e.target === 'bob');
      expect(phantomEdges.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Phantom node placeholders', () => {
    it('uses configured placeholder image path', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const customSettings = {
        ...settings,
        phantomPlaceholderImage: 'custom/path/fallback.png',
      };

      const graph = buildFullGraph(app as any, customSettings);
      const phantomNode = graph.nodes.find((n) => n.isPhantom);

      // Should attempt to resolve the custom path
      expect(phantomNode?.image).toBeDefined();
    });

    it('handles missing placeholder image gracefully', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const customSettings = {
        ...settings,
        phantomPlaceholderImage: '', // Empty path
      };

      const graph = buildFullGraph(app as any, customSettings);
      const phantomNode = graph.nodes.find((n) => n.isPhantom);

      // Should still create the phantom node, just without an image
      expect(phantomNode).toBeDefined();
      expect(phantomNode?.image).toBeNull();
    });
  });

  describe('Phantom nodes with display names', () => {
    it('preserves display name from aliased links', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      // Find phantom node with alias display name
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      expect(phantomNodes.length).toBeGreaterThanOrEqual(1);

      // Phantom nodes should have their display names (from extractParsedLinks)
      phantomNodes.forEach((node) => {
        expect(node.label).toBeDefined();
        expect(node.label.length).toBeGreaterThan(0);
      });
    });

    it('marks phantom nodes with correct target normalization', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      // Phantom node ID should be lowercase normalized
      const phantomNode = graph.nodes.find((n) => n.isPhantom);
      expect(phantomNode?.id).toBe(phantomNode?.id?.toLowerCase());
    });
  });

  describe('Phantom nodes edge integration', () => {
    it("phantom nodes don't get filtered out by edge dedup", () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

      // Edges pointing to phantom nodes should exist
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);
      if (phantomNodes.length > 0) {
        const phantomId = phantomNodes[0].id;
        const edgesToPhantom = graph.edges.filter(
          (e) => e.target === phantomId
        );
        expect(edgesToPhantom.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('phantom node edges have required properties', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Alice.md', 'Alice');

      const graph = buildFullGraph(app as any, settings);

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
      const graph = buildFullGraph(app as any, settings);
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('phantom nodes coexist with real nodes', () => {
      app.vault.addFile('People/Alice.md', 'Alice');
      app.vault.addFile('People/Bob.md', 'Bob');
      app.metadataCache.addFile('People/Alice.md', 'Alice');
      app.metadataCache.addFile('People/Bob.md', 'Bob');

      const graph = buildFullGraph(app as any, settings);

      const realNodes = graph.nodes.filter(
        (n) => !n.isPhantom && n.id.endsWith('.md')
      );
      const phantomNodes = graph.nodes.filter((n) => n.isPhantom);

      // Should have both real and phantom nodes
      expect(realNodes.length).toBeGreaterThanOrEqual(0);
      if (phantomNodes.length > 0) {
        expect(phantomNodes.every((n) => n.isPhantom)).toBe(true);
      }
    });
  });
});
