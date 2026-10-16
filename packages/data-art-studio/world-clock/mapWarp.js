/**
 * Places latitude/longitude on assets/world_map.glb ("World Map" by
 * Daniel.Riches, CC BY 4.0, https://sketchfab.com/3d-models/world-map-b4c6c0cb9b2b4713beb3a6250381d2b0).
 *
 * The model is a stylised Mercator-like map whose continents are shifted and
 * scaled independently, so no single projection fits it. Instead each region
 * has its own quadratic warp from (lon / 100, mercatorY(lat)) to the model's
 * flat x/z plane (model units, before the GLB's node transforms; north is
 * -z). The coefficients were fitted by matching Natural Earth coastlines to
 * the model's coastline (scripts/fit-map-warp.cjs); the mean error is about
 * 20 model units on a map 13 200 units wide.
 */

const WARPS = {
  americas: {
    x: [-532.7052, 2323.768, -617.6247, -561.3839, -851.9973, 131.7021],
    z: [1427.894, -502.8714, -1782.811, -319.1862, 315.5754, 119.9141],
  },
  afroeurasia: {
    x: [-316.9336, 3089.433, 11.10454, -10.63857, -158.4611, 59.84219],
    z: [1587.694, 89.65003, -1911.499, -44.14562, -170.0369, 97.26944],
  },
  oceania: {
    x: [-157.9204, 2966.238, 125.1563, -1.507851, -78.36671, -281.9662],
    z: [1770.981, -228.8591, -1785.39, 95.11817, -141.126, 179.2565],
  },
};

// Same split the fit used.
export function regionOf(lon, lat) {
  if (lon < -25) return "americas";
  if ((lon > 110 && lat < -10) || lon > 160) return "oceania";
  return "afroeurasia";
}

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

/**
 * Model x/z for a point, using `region`'s warp. Pass the same region for a
 * whole country so its outline stays in one piece (Russia's far east has
 * negative longitudes, which are unwrapped for the eastern regions).
 */
export function toModel(lon, lat, region = regionOf(lon, lat)) {
  if (region !== "americas" && lon < -25) lon += 360;
  const x = lon / 100;
  const y = mercatorY(lat);
  const f = [1, x, y, x * x, x * y, y * y];
  const w = WARPS[region];
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < 6; i++) {
    mx += f[i] * w.x[i];
    mz += f[i] * w.z[i];
  }
  return [mx, mz];
}
