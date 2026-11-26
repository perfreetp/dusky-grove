/* ice-crevasse-pulleys — physics model.
 *
 * Pure and deterministic: no DOM, no timers, no rendering. Used by the page and
 * by tools/test.js.
 *
 * Two mechanisms, both always in play — that is the point of the exercise.
 *
 * 1. Ratio (kinematics). The topology of the rig decides how many strands run
 *    to the moving block: n = 1 / 2 / 3. Rope speed and load speed are locked:
 *
 *        v_load = v_rope / n
 *
 *    Nothing about friction can change that; it only changes what it costs.
 *
 * 2. Friction (force). Walked along the rope from the load towards the hands:
 *
 *    sheave pass   T_high = T_low * (1 + k_bear + k_hyst * sin(theta/2)) * mf
 *                  bearing drag plus rope hysteresis: the rope is bent and
 *                  straightened once per pass, and the loss grows with how
 *                  hard it presses into the groove (sin of half the wrap),
 *                  so a sharper bend from a dragged pulley costs more.
 *    prusik        T_high = T_low * e^(mu * theta)            (capstan)
 *                  sliding rope through a friction hitch, by far the hottest
 *                  contact in the system.
 *    mf            grows with rope speed (v^1.4), with load, and again once the
 *                  contact is hot — hot rope grips the ice and the knot harder.
 *
 * Both feed one another: more friction means more pull force at the hands for
 * the same load, and the crew has a finite pull capacity R_MAX, so the haul
 * speed sags as the required force approaches it. A hot contact therefore
 * slows the whole rig down, which is how a heavy haul can bog down even though
 * its nominal ratio is untouched.
 *
 *   F      = product of every contact's ratio           (force penalty)
 *   MA     = n / F                                       (effective advantage)
 *   R_req  = m*g*F/n                                     (force at the hands)
 *   sf     = smoothstep over (1 - R_req/R_MAX)           (speed factor)
 *   P      = T_low * v * (ratio - 1)                     (friction power, W)
 */
(function (root) {
  'use strict';

  var G = 9.81;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep(x, a, b) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  var TUNE = {
    R_MAX: 1000,        // N, sustained haul force the team can hold
    K_BEAR: 0.018,      // bearing drag per sheave pass
    K_HYST: 0.115,      // rope bending hysteresis at a full 180° wrap
    MU_HITCH: 0.032,    // sliding friction through the prusik
    SPEED_K: 0.50,      // mf *= 1 + K*(v/vref)^P
    SPEED_P: 1.4,
    SPEED_REF: 1.0,     // m/s
    WEIGHT_K: 0.20,     // mf *= 1 + K*m/mref
    WEIGHT_REF: 100,    // kg
    HITCH_SPEED_K: 0.45,// the knot bites harder the faster the rope runs
    HEAT_THRESHOLD: 0.50,
    HEAT_GAIN: 1.20,    // extra friction once a contact is running hot
    HEAT_GAIN_SPAN: 0.85, // heat above threshold at which that gain is full
    HEAT_REF: 150,      // W of friction work mapped to heat = 1
    HEAT_MAX: 4.0,
    HEAT_TAU_UP: 1.4,   // s
    HEAT_TAU_DOWN: 7.0, // s
    // A loaded contact keeps rubbing even when the load barely moves: the
    // prusik slips and reseats, the rope saws across the contact. Modelled as
    // extra rubbing speed proportional to how hard the crew is pulling.
    GRIND: 0.70,        // m/s of rub at full load ratio
    GRIND_MAX: 1.2,
    HITCH_EXTRA: 1.7,   // sliding dissipation multiplier for the knot
    HEADROOM: 0.14,     // fraction of R_MAX over which speed falls to zero
    STALL_SPEED: 0.02,  // m/s of load speed at which we call the haul stalled
    GRAB_STEP: 1.0,     // jigger: prusik re-set every 1.0 m of load rise
    GRAB_PAUSE: 0.6,    // s lost per re-set
    JIGGER_DUTY: 0.88,  // speed fraction while actually hauling
    AMBIENT: -9,        // °C
    TEMP_PER_HEAT: 150, // °C asymptote of the temperature curve
    MASS_MIN: 40,
    MASS_MAX: 300,
  };

  var RIGS = {
    single: {
      key: 'single',
      name: '单滑轮',
      short: '1:1',
      ratio: 1,
      desc: '只在裂缝口做一次转向：坠落侧的绳长永远等于拉起侧的绳长，绳速比 1:1，不省力。少了倍率，滑轮与绳索弯曲的损耗却全额由你一个承担。',
      note: '只改方向，不省力',
      contacts: [{ id: 'lip', kind: 'sheave', label: '裂口定滑轮' }],
    },
    double: {
      key: 'double',
      name: '双滑轮',
      short: '2:1',
      ratio: 2,
      desc: '绳端系在裂口锚点，绕过配重上的动滑轮再经定滑轮拉出。配重每升 1 m 要收 2 m 绳：绳速比 2:1，代价是两个滑轮各吃一份摩擦，拉动距离也翻倍。',
      note: '动滑轮：2 股绳',
      contacts: [
        { id: 'mover', kind: 'sheave', label: '配重动滑轮' },
        { id: 'lip', kind: 'sheave', label: '裂口定滑轮' },
      ],
    },
    jigger: {
      key: 'jigger',
      name: '带抓结滑轮组',
      short: '3:1',
      ratio: 3,
      desc: '绳端系在背带上，绕过动滑轮经裂口双槽定滑轮拉出，出口用抓结自锁。配重侧合成 3 股绳，绳速比 3:1。理论最省力，但抓结是最烫的摩擦点，而且每 1 m 就要重新移位。',
      note: '3 股绳 + 抓结自锁',
      contacts: [
        { id: 'lip', kind: 'sheave', label: '裂口定滑轮 A' },
        { id: 'mover', kind: 'sheave', label: '配重动滑轮' },
        { id: 'lip2', kind: 'sheave', label: '裂口定滑轮 B' },
        { id: 'hitch', kind: 'hitch', label: '抓结（摩擦结）' },
      ],
    },
  };

  var HITCH_WRAP = 1.05; // rad: the rope crosses the prusik at a set angle

  function createState(rigKey, mass) {
    var rig = RIGS[rigKey] || RIGS.single;
    var heat = [], temp = [];
    for (var i = 0; i < rig.contacts.length; i++) { heat.push(0); temp.push(TUNE.AMBIENT); }
    return {
      rig: rig.key,
      mass: mass == null ? 70 : mass,
      lift: 0,
      vRope: 0,
      vLoad: 0,
      heat: heat,
      temp: temp,
      hot: 0,
      hottest: 0,
      heated: false,
      peakHeat: 0,
      peakContact: 0,
      stalled: false,
      stall: null,           // { mass, contact, label, heat, temp, F, MA }
      resets: 0,
      grabPos: 0,
      grabPause: 0,
      time: 0,
      distance: 0,
    };
  }

  /* Degradation common to every contact: speed, load, and heat. */
  function degr(v, mass, heat) {
    var speed = Math.abs(v);
    var f = 1 + TUNE.SPEED_K * Math.pow(speed / TUNE.SPEED_REF, TUNE.SPEED_P);
    f *= 1 + TUNE.WEIGHT_K * (mass / TUNE.WEIGHT_REF);
    f *= 1 + TUNE.HEAT_GAIN *
      smoothstep(heat, TUNE.HEAT_THRESHOLD, TUNE.HEAT_THRESHOLD + TUNE.HEAT_GAIN_SPAN);
    return f;
  }

  /* One contact: wrap angle theta (rad), rope moving at v (m/s). */
  function contactLoss(rig, i, theta, v, mass, heat) {
    var c = rig.contacts[i];
    var mf = degr(v, mass, heat);
    var th = clamp(theta, 0.06, Math.PI * 1.1);
    if (c.kind === 'hitch') {
      var mu = TUNE.MU_HITCH * mf * (1 + TUNE.HITCH_SPEED_K * Math.abs(v));
      var phi = mu * th;
      return { mu: mu, theta: th, phi: phi, ratio: Math.exp(phi), kind: 'capstan' };
    }
    // Bending/stiffness loss grows super-linearly with wrap: a sharper fold
    // presses the rope deeper into the groove. Dragging a pulley therefore has
    // a measurable cost, not just a visual one.
    var bend = Math.pow(Math.min(th, Math.PI) / Math.PI, 1.5);
    var k = (TUNE.K_BEAR + TUNE.K_HYST * bend) * mf;
    return { mu: 0, theta: th, phi: k, ratio: 1 + k, kind: 'sheave' };
  }

  function solveForces(st, rig, wraps, v, mass) {
    var losses = [], F = 1;
    for (var i = 0; i < rig.contacts.length; i++) {
      var L = contactLoss(rig, i, wraps[i], v, mass, st.heat[i]);
      losses.push(L);
      F *= L.ratio;
    }
    return { losses: losses, F: F };
  }

  function defaultWraps(rig) {
    return rig.contacts.map(function (c) { return c.kind === 'hitch' ? HITCH_WRAP : Math.PI * 0.62; });
  }

  /* step(st, { dt, pulling, vCmd, wraps, liftSpan })
   *   vCmd      commanded rope speed at the hands (m/s)
   *   wraps     wrap angle (rad) per contact, from the drawn geometry
   *   liftSpan  metres of crevasse between the load and the mouth
   */
  function step(st, o) {
    var rig = RIGS[st.rig];
    var dt = clamp(o.dt || 1 / 60, 0.001, 0.12);
    if (o.mass != null) st.mass = clamp(o.mass, 0, 600);
    var wraps = (o.wraps && o.wraps.length === rig.contacts.length) ? o.wraps : defaultWraps(rig);
    var n = clamp(o.ratio == null ? rig.ratio : o.ratio, 0.35 * rig.ratio, rig.ratio);
    var pulling = !!o.pulling;
    var vCmd = pulling ? clamp(o.vCmd == null ? 0.6 : o.vCmd, 0, 3) : 0;
    var done = st.lift >= 0.9995;

    // Jigger: the prusik has to be walked along the rope every GRAB_STEP m.
    st.grabPause = Math.max(0, st.grabPause - dt);
    var paused = st.grabPause > 0;
    if (paused || done) vCmd = 0;

    // Force balance at the speed the crew is trying to hold.
    var vFric = pulling ? Math.max(vCmd, 0.05) : Math.max(Math.abs(st.vRope), 0.02);
    var ev = solveForces(st, rig, wraps, vFric, st.mass);
    ev.Rreq = (st.mass * G * ev.F) / n;

    // A finite crew: speed sags as the required force approaches capacity.
    var head = 1 - ev.Rreq / TUNE.R_MAX;
    var sf = smoothstep(head, 0, TUNE.HEADROOM);
    var duty = rig.key === 'jigger' ? TUNE.JIGGER_DUTY : 1;
    var vRope = vCmd * sf * duty;
    if (vRope < 0.004) vRope = 0;
    st.vRope = vRope;
    st.vLoad = vRope / n;

    /* Heat. Work dissipated at a contact is T_low*(ratio-1)*v, so friction
     * power walks up the rope with the tension. When the crew keeps hauling
     * but the load only creeps, a loaded contact still rubs (grind). */
    var stalledNow = pulling && !paused && !done && sf < 0.055;
    var grind = (pulling && !paused && !done)
      ? Math.min(TUNE.GRIND_MAX, TUNE.GRIND * clamp(ev.Rreq / TUNE.R_MAX, 0, 1.6))
      : 0;
    var vRub = vRope + grind;
    var Tin = (st.mass * G) / n;
    var powers = [], hottest = 0, hot = 0, worst = 0, worstLoss = -1;
    for (var k = 0; k < rig.contacts.length; k++) {
      var L = ev.losses[k];
      var Thigh = Tin * L.ratio;
      var P = Tin * (L.ratio - 1) * vRub * (rig.contacts[k].kind === 'hitch' ? TUNE.HITCH_EXTRA : 1);
      powers.push(P);
      Tin = Thigh;
      // heat is proportional to dissipated power, with a wide enough range that
      // the contacts stay distinguishable even when several are rubbing hard
      var target = clamp(P / TUNE.HEAT_REF, 0, TUNE.HEAT_MAX);
      var tau = target > st.heat[k] ? TUNE.HEAT_TAU_UP : TUNE.HEAT_TAU_DOWN;
      st.heat[k] += (target - st.heat[k]) * (1 - Math.exp(-dt / tau));
      // rope is thin and sits in cold air: temperature saturates long before
      // the dissipated power does, so it never reads absurd
      st.temp[k] = TUNE.AMBIENT + TUNE.TEMP_PER_HEAT * (1 - Math.exp(-st.heat[k] * 0.30));
      if (st.heat[k] > hot) { hot = st.heat[k]; hottest = k; }
      if (L.ratio - 1 > worstLoss) { worstLoss = L.ratio - 1; worst = k; }
    }
    st.hot = hot;
    st.hottest = hottest;
    st.worst = worst;
    st.heated = hot >= TUNE.HEAT_THRESHOLD;
    if (hot > st.peakHeat) { st.peakHeat = hot; st.peakContact = hottest; }

    // Travel.
    if (vRope > 0) {
      st.lift = clamp(st.lift + (st.vLoad * dt) / (o.liftSpan || 4), 0, 1);
      st.distance += st.vLoad * dt;
      if (rig.key === 'jigger') {
        st.grabPos += st.vLoad * dt;
        if (st.grabPos >= TUNE.GRAB_STEP) {
          st.grabPos -= TUNE.GRAB_STEP;
          st.grabPause = TUNE.GRAB_PAUSE;
          st.resets++;
        }
      }
    }

    // Stall: the crew is pulling, the load is not coming up.
    var was = st.stalled;
    st.stalled = stalledNow || (pulling && !paused && !done &&
      st.vLoad < TUNE.STALL_SPEED / n && ev.Rreq > TUNE.R_MAX * 0.9);
    if (st.stalled && !was) {
      // The stall report names the segment carrying the heaviest friction, and
      // separately records the hottest one, so both facts stay available.
      st.stall = {
        mass: Math.round(st.mass),
        contact: worst,
        label: rig.contacts[worst].label,
        friction: worstLoss,
        hotContact: hottest,
        hotLabel: rig.contacts[hottest].label,
        heat: hot,
        temp: st.temp[hottest],
        F: ev.F,
        MA: n / ev.F,
        Rreq: ev.Rreq,
        time: st.time,
      };
    }
    st.time += dt;

    return {
      rig: rig.key,
      ratio: n,
      nominalRatio: rig.ratio,
      wraps: wraps.slice(),
      losses: ev.losses,
      F: ev.F,
      efficiency: 1 / ev.F,
      ma: n / ev.F,
      Rreq: ev.Rreq,
      Rmax: TUNE.R_MAX,
      loadRatio: ev.Rreq / TUNE.R_MAX,
      headroom: head,
      speedFactor: paused ? 0 : sf,
      vRope: vRope,
      vLoad: st.vLoad,
      vCmd: vCmd,
      pulling: pulling,
      paused: paused,
      done: done,
      stalled: st.stalled,
      moving: vRope > 0.006,
      power: powers,
      frictionPower: powers.reduce(function (a, b) { return a + b; }, 0),
      heat: st.heat.slice(),
      temp: st.temp.slice(),
      hot: hot,
      hottest: hottest,
      worst: worst,
      worstLoss: Math.max(0, worstLoss),
      heated: st.heated,
      mass: st.mass,
      lift: st.lift,
      distance: st.distance,
      stall: st.stall,
      grabPause: st.grabPause,
      resets: st.resets,
      ambient: TUNE.AMBIENT,
      threshold: TUNE.HEAT_THRESHOLD,
    };
  }

  /* Headless sweep: ramp the mass, hold a steady pull for a few seconds at
   * each step (so heat builds up the way it would), and report the first mass
   * the crew cannot lift. */
  function findStall(rigKey, o) {
    o = o || {};
    var rig = RIGS[rigKey];
    var wraps = o.wraps || defaultWraps(rig);
    var from = o.from || TUNE.MASS_MIN;
    var to = o.to || TUNE.MASS_MAX;
    var stepM = o.step || 2;
    var pull = o.vCmd || 0.6;
    var ratio = o.ratio || rig.ratio;
    var settle = o.settle || 5;
    var dt = 1 / 60;
    var prev = null;
    for (var m = from; m <= to; m += stepM) {
      var st = createState(rigKey, m);
      var last = null, travelled = 0;
      for (var i = 0; i < Math.round(settle / dt); i++) {
        last = step(st, { dt: dt, pulling: true, vCmd: pull, wraps: wraps, ratio: ratio, liftSpan: 1e6 });
        travelled += last.vLoad * dt;
      }
      if (travelled < 0.12) {
        var near = prev || last;
        var ci = near.stallContact != null ? near.stallContact : near.hottest;
        return {
          mass: m,
          contact: ci,
          label: rig.contacts[ci].label,
          heat: near.hot,
          temp: near.temp[near.hottest],
          F: near.F,
          efficiency: near.efficiency,
          ma: near.ma,
          Rreq: near.Rreq,
        };
      }
      prev = last;
    }
    return null;
  }

  var api = {
    G: G, TUNE: TUNE, RIGS: RIGS, HITCH_WRAP: HITCH_WRAP,
    createState: createState,
    contactLoss: contactLoss,
    defaultWraps: defaultWraps,
    step: step,
    findStall: findStall,
    clamp: clamp,
    smoothstep: smoothstep,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IcePhys = api;
})(typeof window !== 'undefined' ? window : globalThis);
