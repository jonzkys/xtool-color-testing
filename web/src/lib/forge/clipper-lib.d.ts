// Minimal type declarations for `clipper-lib` (Angus Johnson's Clipper, JS port).
// Only the surface Contour Forge uses. Coordinates are integers ({X, Y}).
declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  interface ClipperOffset {
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    AddPaths(paths: IntPoint[][], joinType: number, endType: number): void;
    Execute(solution: IntPoint[][], delta: number): void;
    Clear(): void;
  }

  interface Clipper {
    AddPaths(paths: IntPoint[][], polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: IntPoint[][],
      subjFillType?: number,
      clipFillType?: number,
    ): boolean;
  }

  interface ClipperLibStatic {
    IntPoint: new (x: number, y: number) => IntPoint;
    Paths: new () => IntPoint[][];
    Clipper: new (initOptions?: number) => Clipper;
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => ClipperOffset;
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: {
      etOpenSquare: number;
      etOpenRound: number;
      etOpenButt: number;
      etClosedLine: number;
      etClosedPolygon: number;
    };
    PolyType: { ptSubject: number; ptClip: number };
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyFillType: {
      pftEvenOdd: number;
      pftNonZero: number;
      pftPositive: number;
      pftNegative: number;
    };
  }

  const ClipperLib: ClipperLibStatic;
  export default ClipperLib;
}
