import { describe, it, expect } from 'vitest';
import { convertConnectionsToOrthogonal } from './svg-orthogonal';

describe('svg-orthogonal', () => {
    it('should process simple path', () => {
        const inputSvg = `
<svg>
  <g class="connection">
    <path d="M 10 10 L 100 100" />
  </g>
</svg>`;
        const output = convertConnectionsToOrthogonal(inputSvg);
        // We expect d to change to orthogonal: M 10 10 ... L 55 10 ... L 55 100 ... L 100 100 (since dx=dy=90)
        // Wait, my logic prefers H first if dx > dy. Here dx=90, dy=90.
        // If equal, it goes V first (else block).
        // V-H-V: M 10 10 L 10 55 L 100 55 L 100 100
        
        expect(output).toContain('d="M 10 10 L 10 55 L 100 55 L 100 100"');
    });

    it('should ignore non-connection paths', () => {
        const inputSvg = `
<svg>
  <g class="node">
    <path d="M 0 0 L 10 10" />
  </g>
</svg>`;
        const output = convertConnectionsToOrthogonal(inputSvg);
        // Should remain unchanged
        expect(output).toContain('d="M 0 0 L 10 10"');
    });

    it('should handle Bezier curves', () => {
       const inputSvg = `
<svg>
  <g class="connection">
    <path d="M 10 10 C 20 20 80 80 100 100" />
  </g>
</svg>`;
       const output = convertConnectionsToOrthogonal(inputSvg);
       // Should be orthogonalized
       expect(output).toContain('d="M 10 10 L 10 55 L 100 55 L 100 100"'); // Same logic as line
    });
});
