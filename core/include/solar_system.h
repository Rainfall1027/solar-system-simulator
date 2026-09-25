#ifndef SOLAR_SYSTEM_H
#define SOLAR_SYSTEM_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Solar-system N-body core.
 *
 * Units: SI (m, s, kg). Frame: J2000 ecliptic (ICRF based) with its origin at
 * the solar-system barycentre; +X toward the vernal equinox, +Z toward ecliptic
 * north, planets orbit counter-clockwise seen from +Z. Time: TDB seconds since
 * the epoch below. Display code maps (x, y, z) to scene (x, z, -y) and applies
 * any display scaling itself; scaled values are never written back here.
 *
 * Physics: Newtonian point-mass gravity between every pair of bodies plus the
 * J2 oblateness term of bodies that declare one (Earth, Jupiter). Bodies with
 * gm <= 0 are test particles: attracted, but exerting no force. Not modelled:
 * relativity, higher zonal harmonics, tides, non-gravitational forces.
 */

#define SOLAR_G 6.67430e-11
#define SOLAR_MAX_BODIES 64
/* Default bound on one integration step. Resolves Io (1.77-day orbit). */
#define SOLAR_DEFAULT_MAX_STEP_S 600.0
/* solar_system_advance refuses to subdivide into more steps than this. */
#define SOLAR_MAX_ADVANCE_STEPS 10000000u

/* Epoch of solar_system_init: 2026-09-21 00:00:00 TDB (JD 2461304.5).
 * TDB - UTC is 69.184 s here (37 leap seconds + 32.184 s, TDB-TT < 2 ms). */
#define SOLAR_EPOCH_JD_TDB 2461304.5
#define SOLAR_EPOCH_TDB_MINUS_UTC_S 69.184

/* Catalog order. Indices equal ids right after solar_system_init. Keys match
 * the web front end's body ids. */
typedef enum SolarBodyId {
    SOLAR_SUN = 0,
    SOLAR_MERCURY,
    SOLAR_VENUS,
    SOLAR_EARTH,
    SOLAR_MARS,
    SOLAR_JUPITER,
    SOLAR_SATURN,
    SOLAR_URANUS,
    SOLAR_NEPTUNE,
    SOLAR_MOON,
    SOLAR_IO,
    SOLAR_EUROPA,
    SOLAR_GANYMEDE,
    SOLAR_CALLISTO,
    SOLAR_CATALOG_COUNT
} SolarBodyId;

typedef enum SolarIntegrator {
    /* 4th-order symplectic composition of three velocity-Verlet substeps. */
    SOLAR_INTEGRATOR_YOSHIDA4 = 0,
    /* 2nd-order symplectic velocity Verlet (kick-drift-kick). */
    SOLAR_INTEGRATOR_VELOCITY_VERLET
} SolarIntegrator;

typedef struct SolarBody {
    int id;               /* SolarBodyId, or -1 for a body added at run time */
    int parent;           /* index of the body it orbits, or -1 (metadata only) */
    const char *key;      /* stable ASCII key, e.g. "earth"; may be NULL */
    const char *name;     /* UTF-8 display name; may be NULL */
    double gm_m3_s2;      /* gravitational parameter G*M; <= 0: test particle */
    double radius_m;      /* mean radius */
    double j2;            /* zonal oblateness coefficient; 0 = spherical */
    double j2_radius_m;   /* reference equatorial radius of j2 */
    double pole[3];       /* unit spin axis in the simulation frame */
    double position_m[3];
    double velocity_m_s[3];
} SolarBody;

typedef struct SolarSystem {
    SolarBody bodies[SOLAR_MAX_BODIES];
    size_t body_count;
    double simulation_time_s; /* TDB seconds since the epoch */
    SolarIntegrator integrator;
} SolarSystem;

/* Sun, eight planets, the Moon and the Galilean satellites at the epoch, with
 * JPL Horizons barycentric states. Saturn, Uranus and Neptune (and Mars) are
 * their system barycentres with system GM, as their moons are not simulated. */
void solar_system_init(SolarSystem *system);

/* No bodies, time zero, default integrator. */
void solar_system_init_empty(SolarSystem *system);

/* Idealized momentum-balanced circular Sun/Earth pair at 1 AU (two bodies).
 * A deterministic integrator benchmark, not an ephemeris state. */
void solar_system_init_sun_earth(SolarSystem *system);

/* Appends a copy of body. Returns its index, or -1 when full, when body is
 * invalid (non-finite state, parent out of range) or on NULL input. */
int solar_system_add_body(SolarSystem *system, const SolarBody *body);

/* One integration step. Nonpositive/nonfinite seconds are ignored without
 * touching the state. Use solar_system_advance for long durations. */
void solar_system_step(SolarSystem *system, double seconds);

/* Advances by seconds using equal steps no longer than max_step_s
 * (<= 0 or nonfinite: SOLAR_DEFAULT_MAX_STEP_S). Returns the number of steps
 * taken; 0 for invalid input or more than SOLAR_MAX_ADVANCE_STEPS steps. */
size_t solar_system_advance(SolarSystem *system, double seconds, double max_step_s);

/* Kinetic + Newtonian + J2 potential energy in joules; NAN for NULL. */
double solar_system_total_energy_j(const SolarSystem *system);

/* Mass derived from gm (0 for test particles). */
double solar_body_mass_kg(const SolarBody *body);

/* Body with the given catalog id, or NULL. */
const SolarBody *solar_system_body(const SolarSystem *system, SolarBodyId id);

#ifdef __cplusplus
}
#endif

#endif
