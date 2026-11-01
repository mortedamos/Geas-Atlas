// Fractal detail for coastlines. The coast is traced at about a map pixel (8-9 miles), so zoomed in it is a row of straight lines.
// Real coasts have detail at every scale (Mandelbrot's "how long is the coast of Britain"), so below COARSE feet each straight piece is
// split at its midpoint and the midpoint is nudged sideways, again and again, by an amount that shrinks with the piece's length as
// length^H (H = 0.75, a coast of fractal dimension about 1.25). Larger pieces are only split in a straight line, so the coast never
// strays from the traced one by more than a few hundred feet. The nudge is a hash of the piece's two ends: the same piece always
// gets the same detail, so the map (in the browser) and the town plans (tools/towns.mjs) agree on where the shore is.
// Used as a plain script in the browser (window.FractalCoast) and with require() in Node.
(function (root) {
  const COARSE = 600; // feet: below this length a piece gets rough
  const ROUGH = 0.18; // nudge size at COARSE, as a share of the piece length
  const H = 0.75;

  function hash(ax, ay, bx, by) { // a number in [0, 1) from the two ends of a piece
    let h = 2166136261;
    for (const v of [ax, ay, bx, by]) { h ^= Math.round(v * 1e6) | 0; h = Math.imul(h, 16777619); h ^= h >>> 15; }
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // refine one straight piece (world px); `ft` is feet per world px, `minFt` the shortest piece wanted. Appends points (not the start).
  function refinePiece(ax, ay, bx, by, ft, minFt, out) {
    const L = Math.hypot(bx - ax, by - ay) * ft;
    if (L <= minFt) { out.push([bx, by]); return; }
    let mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (L <= COARSE) {
      const amp = (ROUGH * Math.pow(COARSE, 1 - H) * Math.pow(L, H)) / ft, nx = -(by - ay) / (L / ft), ny = (bx - ax) / (L / ft), r = hash(ax, ay, bx, by) * 2 - 1;
      mx += nx * amp * r; my += ny * amp * r;
    }
    refinePiece(ax, ay, mx, my, ft, minFt, out);
    refinePiece(mx, my, bx, by, ft, minFt, out);
  }

  // refine a polyline (array of [x, y] in world px); keep(i) may say that segment i can be left alone (off screen)
  function refinePolyline(pts, ft, minFt, keep) {
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (keep && !keep(i)) out.push(pts[i + 1]);
      else refinePiece(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ft, minFt, out);
    }
    return out;
  }

  const api = { refinePolyline, refinePiece, COARSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FractalCoast = api;
})(typeof window !== 'undefined' ? window : globalThis);
