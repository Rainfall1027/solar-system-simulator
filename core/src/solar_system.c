#include "solar_system.h"

#include <math.h>
#include <string.h>

#define AU_M 149597870700.0
#define KM3_TO_M3 1.0e9
#define DEG_TO_RAD (3.14159265358979323846 / 180.0)
/* IAU 2006 J2000 obliquity, 84381.406"; Horizons' ecliptic uses 84381.448". */
#define OBLIQUITY_J2000_RAD (84381.448 / 3600.0 * DEG_TO_RAD)

#include "solar_system_epoch.inc"

typedef struct CatalogEntry {
    const char *key;
    const char *name;
    double gm_km3_s2;
    double radius_m;
    int parent;
    double j2;
    double j2_radius_m;
    double pole_ra_deg;   /* spin axis, ICRF right ascension */
    double pole_dec_deg;  /* spin axis, ICRF declination */
} CatalogEntry;

/*
 * GM: JPL Horizons physical data (DE440/JUP365); system values for Mars,
 * Saturn, Uranus and Neptune because their moons are not separate bodies.
 * Mean radii: NASA NSSDC. J2: IERS 2010 (Earth), Juno (Iess et al. 2018,
 * Jupiter). Poles: IAU WGCCRE 2015, J2000 values without precession terms.
 */
static const CatalogEntry CATALOG[SOLAR_CATALOG_COUNT] = {
    {"sun",      "太阳",   132712440041.93938, 696340000.0, -1,            0.0,         0.0,         0.0,        90.0},
    {"mercury",  "水星",   22031.86855,        2439500.0,   -1,            0.0,         0.0,         0.0,        90.0},
    {"venus",    "金星",   324858.592,         6051800.0,   -1,            0.0,         0.0,         0.0,        90.0},
    {"earth",    "地球",   398600.435436,      6371008.8,   -1,            1.0826359e-3, 6378136.6,  0.0,        90.0},
    {"mars",     "火星",   42828.375662,       3389500.0,   -1,            0.0,         0.0,         0.0,        90.0},
    {"jupiter",  "木星",   126686531.900,      69911000.0,  -1,            1.46965e-2,  71492000.0,  268.056595, 64.495303},
    {"saturn",   "土星",   37940584.8418,      58232000.0,  -1,            0.0,         0.0,         0.0,        90.0},
    {"uranus",   "天王星", 5794556.4,          25362000.0,  -1,            0.0,         0.0,         0.0,        90.0},
    {"neptune",  "海王星", 6836527.10058,      24622000.0,  -1,            0.0,         0.0,         0.0,        90.0},
    {"moon",     "月球",   4902.800066,        1737400.0,   SOLAR_EARTH,   0.0,         0.0,         0.0,        90.0},
    {"io",       "木卫一", 5959.9155,          1821600.0,   SOLAR_JUPITER, 0.0,         0.0,         0.0,        90.0},
    {"europa",   "木卫二", 3202.7121,          1560800.0,   SOLAR_JUPITER, 0.0,         0.0,         0.0,        90.0},
    {"ganymede", "木卫三", 9887.8328,          2634100.0,   SOLAR_JUPITER, 0.0,         0.0,         0.0,        90.0},
    {"callisto", "木卫四", 7179.2834,          2410300.0,   SOLAR_JUPITER, 0.0,         0.0,         0.0,        90.0}
};

/* Converts an ICRF (equatorial) direction to the J2000 ecliptic frame. */
static void pole_to_ecliptic(double ra_deg, double dec_deg, double out[3]) {
    const double ra = ra_deg * DEG_TO_RAD;
    const double dec = dec_deg * DEG_TO_RAD;
    const double x = cos(dec) * cos(ra);
    const double y = cos(dec) * sin(ra);
    const double z = sin(dec);
    out[0] = x;
    out[1] = y * cos(OBLIQUITY_J2000_RAD) + z * sin(OBLIQUITY_J2000_RAD);
    out[2] = -y * sin(OBLIQUITY_J2000_RAD) + z * cos(OBLIQUITY_J2000_RAD);
}

static void catalog_body(SolarBody *body, SolarBodyId id) {
    const CatalogEntry *entry = &CATALOG[id];
    memset(body, 0, sizeof(*body));
    body->id = (int)id;
    body->parent = entry->parent;
    body->key = entry->key;
    body->name = entry->name;
    body->gm_m3_s2 = entry->gm_km3_s2 * KM3_TO_M3;
    body->radius_m = entry->radius_m;
    body->j2 = entry->j2;
    body->j2_radius_m = entry->j2_radius_m;
    pole_to_ecliptic(entry->pole_ra_deg, entry->pole_dec_deg, body->pole);
}

static double active_gm(const SolarBody *body) {
    return body->gm_m3_s2 > 0.0 ? body->gm_m3_s2 : 0.0;
}

static void calculate_accelerations(const SolarSystem *system, double acceleration[][3]) {
    const size_t count = system->body_count;
    size_t i;
    size_t j;

    memset(acceleration, 0, sizeof(double) * 3 * count);
    /* Point-mass gravity. A test particle is attracted but exerts no force;
     * a pair of test particles does not interact at all. */
    for (i = 0; i < count; ++i) {
        const SolarBody *a = &system->bodies[i];
        for (j = i + 1; j < count; ++j) {
            const SolarBody *b = &system->bodies[j];
            const double gm_a = active_gm(a);
            const double gm_b = active_gm(b);
            if (gm_a == 0.0 && gm_b == 0.0) continue;
            const double dx = b->position_m[0] - a->position_m[0];
            const double dy = b->position_m[1] - a->position_m[1];
            const double dz = b->position_m[2] - a->position_m[2];
            const double distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared == 0.0) continue;
            const double inverse_distance = 1.0 / sqrt(distance_squared);
            const double inverse_cubed = inverse_distance * inverse_distance * inverse_distance;
            acceleration[i][0] += gm_b * inverse_cubed * dx;
            acceleration[i][1] += gm_b * inverse_cubed * dy;
            acceleration[i][2] += gm_b * inverse_cubed * dz;
            acceleration[j][0] -= gm_a * inverse_cubed * dx;
            acceleration[j][1] -= gm_a * inverse_cubed * dy;
            acceleration[j][2] -= gm_a * inverse_cubed * dz;
        }
    }

    /* J2 oblateness of body i acting on every other body j, with the equal and
     * opposite reaction on i. With r = r_j - r_i and z = r . pole:
     *   a_j = -3/2 J2 GM_i R^2 / r^5 [(1 - 5 z^2/r^2) r + 2 z pole]
     * The spin axis is held fixed, so energy and linear momentum are conserved
     * while the (unmodelled) spin-orbit torque is not. */
    for (i = 0; i < count; ++i) {
        const SolarBody *oblate = &system->bodies[i];
        const double gm_i = active_gm(oblate);
        if (oblate->j2 == 0.0 || gm_i == 0.0) continue;
        const double coefficient = -1.5 * oblate->j2 * gm_i * oblate->j2_radius_m * oblate->j2_radius_m;
        for (j = 0; j < count; ++j) {
            if (j == i) continue;
            const SolarBody *other = &system->bodies[j];
            const double r[3] = {
                other->position_m[0] - oblate->position_m[0],
                other->position_m[1] - oblate->position_m[1],
                other->position_m[2] - oblate->position_m[2]
            };
            const double r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
            if (r2 == 0.0) continue;
            const double inverse_r2 = 1.0 / r2;
            const double inverse_r5 = inverse_r2 * inverse_r2 / sqrt(r2);
            const double z = r[0] * oblate->pole[0] + r[1] * oblate->pole[1] + r[2] * oblate->pole[2];
            const double radial = 1.0 - 5.0 * z * z * inverse_r2;
            const double reaction = active_gm(other) / gm_i;
            for (size_t axis = 0; axis < 3; ++axis) {
                const double a = coefficient * inverse_r5 * (radial * r[axis] + 2.0 * z * oblate->pole[axis]);
                acceleration[j][axis] += a;
                acceleration[i][axis] -= reaction * a;
            }
        }
    }
}

/* Velocity Verlet. acceleration holds a(t) on entry and a(t + h) on exit, so
 * consecutive substeps share one force evaluation. */
static void velocity_verlet(SolarSystem *system, double h, double acceleration[][3]) {
    double next[SOLAR_MAX_BODIES][3];
    const size_t count = system->body_count;
    size_t index;

    for (index = 0; index < count; ++index) {
        SolarBody *body = &system->bodies[index];
        for (size_t axis = 0; axis < 3; ++axis) {
            body->position_m[axis] += body->velocity_m_s[axis] * h + 0.5 * acceleration[index][axis] * h * h;
        }
    }
    calculate_accelerations(system, next);
    for (index = 0; index < count; ++index) {
        SolarBody *body = &system->bodies[index];
        for (size_t axis = 0; axis < 3; ++axis) {
            body->velocity_m_s[axis] += 0.5 * (acceleration[index][axis] + next[index][axis]) * h;
            acceleration[index][axis] = next[index][axis];
        }
    }
}

static int state_is_finite(const SolarBody *body) {
    for (size_t axis = 0; axis < 3; ++axis) {
        if (!isfinite(body->position_m[axis]) || !isfinite(body->velocity_m_s[axis])) return 0;
    }
    return isfinite(body->gm_m3_s2) && isfinite(body->j2) && isfinite(body->j2_radius_m);
}

void solar_system_init_empty(SolarSystem *system) {
    if (system == NULL) return;
    memset(system, 0, sizeof(*system));
    system->integrator = SOLAR_INTEGRATOR_YOSHIDA4;
}

void solar_system_init(SolarSystem *system) {
    if (system == NULL) return;
    solar_system_init_empty(system);
    for (size_t index = 0; index < SOLAR_CATALOG_COUNT; ++index) {
        SolarBody *body = &system->bodies[index];
        catalog_body(body, (SolarBodyId)index);
        for (size_t axis = 0; axis < 3; ++axis) {
            body->position_m[axis] = EPOCH_STATES[index][axis];
            body->velocity_m_s[axis] = EPOCH_STATES[index][axis + 3];
        }
    }
    system->body_count = SOLAR_CATALOG_COUNT;
}

void solar_system_init_sun_earth(SolarSystem *system) {
    if (system == NULL) return;
    solar_system_init_empty(system);
    catalog_body(&system->bodies[0], SOLAR_SUN);
    catalog_body(&system->bodies[1], SOLAR_EARTH);
    /* Spherical Earth keeps this an exact Kepler two-body benchmark. */
    system->bodies[1].j2 = 0.0;
    system->bodies[1].parent = -1;
    system->body_count = 2;

    const double distance = 1.00000011 * AU_M;
    const double gm_sun = system->bodies[0].gm_m3_s2;
    const double gm_earth = system->bodies[1].gm_m3_s2;
    const double total = gm_sun + gm_earth;
    const double speed = sqrt(total / distance);
    /* Barycentric, prograde about +Z: Earth at +X moving toward +Y. */
    system->bodies[1].position_m[0] = distance * gm_sun / total;
    system->bodies[0].position_m[0] = -distance * gm_earth / total;
    system->bodies[1].velocity_m_s[1] = speed * gm_sun / total;
    system->bodies[0].velocity_m_s[1] = -speed * gm_earth / total;
}

int solar_system_add_body(SolarSystem *system, const SolarBody *body) {
    if (system == NULL || body == NULL || system->body_count >= SOLAR_MAX_BODIES) return -1;
    if (!state_is_finite(body)) return -1;
    if (body->parent < -1 || body->parent >= (int)system->body_count) return -1;
    const size_t index = system->body_count;
    system->bodies[index] = *body;
    system->body_count = index + 1;
    return (int)index;
}

void solar_system_step(SolarSystem *system, double seconds) {
    double acceleration[SOLAR_MAX_BODIES][3];

    if (system == NULL || !isfinite(seconds) || seconds <= 0.0 ||
        !isfinite(system->simulation_time_s + seconds)) {
        return;
    }
    calculate_accelerations(system, acceleration);
    if (system->integrator == SOLAR_INTEGRATOR_VELOCITY_VERLET) {
        velocity_verlet(system, seconds, acceleration);
    } else {
        /* Yoshida (1990) 4th-order symmetric composition. */
        const double cube_root_two = cbrt(2.0);
        const double outer = 1.0 / (2.0 - cube_root_two);
        const double inner = -cube_root_two / (2.0 - cube_root_two);
        velocity_verlet(system, outer * seconds, acceleration);
        velocity_verlet(system, inner * seconds, acceleration);
        velocity_verlet(system, outer * seconds, acceleration);
    }
    system->simulation_time_s += seconds;
}

size_t solar_system_advance(SolarSystem *system, double seconds, double max_step_s) {
    if (system == NULL || !isfinite(seconds) || seconds <= 0.0) return 0;
    if (!isfinite(max_step_s) || max_step_s <= 0.0) max_step_s = SOLAR_DEFAULT_MAX_STEP_S;
    const double needed = ceil(seconds / max_step_s);
    if (!(needed <= (double)SOLAR_MAX_ADVANCE_STEPS)) return 0;
    const size_t steps = needed < 1.0 ? 1 : (size_t)needed;
    const double start = system->simulation_time_s;
    const double h = seconds / (double)steps;
    for (size_t step = 0; step < steps; ++step) {
        solar_system_step(system, h);
    }
    /* Remove accumulated rounding in the clock itself. */
    system->simulation_time_s = start + seconds;
    return steps;
}

double solar_system_total_energy_j(const SolarSystem *system) {
    double total = 0.0;

    if (system == NULL) return NAN;
    const size_t count = system->body_count;
    for (size_t i = 0; i < count; ++i) {
        const SolarBody *a = &system->bodies[i];
        const double speed_squared = a->velocity_m_s[0] * a->velocity_m_s[0] +
                                     a->velocity_m_s[1] * a->velocity_m_s[1] +
                                     a->velocity_m_s[2] * a->velocity_m_s[2];
        total += 0.5 * solar_body_mass_kg(a) * speed_squared;
        for (size_t j = i + 1; j < count; ++j) {
            const SolarBody *b = &system->bodies[j];
            const double dx = b->position_m[0] - a->position_m[0];
            const double dy = b->position_m[1] - a->position_m[1];
            const double dz = b->position_m[2] - a->position_m[2];
            const double distance = sqrt(dx * dx + dy * dy + dz * dz);
            if (distance == 0.0) continue;
            total -= active_gm(a) * active_gm(b) / (SOLAR_G * distance);
        }
    }
    /* J2 potential energy: m_j * GM_i J2 R^2 P2(z/r) / r^3. */
    for (size_t i = 0; i < count; ++i) {
        const SolarBody *oblate = &system->bodies[i];
        const double gm_i = active_gm(oblate);
        if (oblate->j2 == 0.0 || gm_i == 0.0) continue;
        for (size_t j = 0; j < count; ++j) {
            if (j == i) continue;
            const SolarBody *other = &system->bodies[j];
            const double r[3] = {
                other->position_m[0] - oblate->position_m[0],
                other->position_m[1] - oblate->position_m[1],
                other->position_m[2] - oblate->position_m[2]
            };
            const double r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
            if (r2 == 0.0) continue;
            const double z = r[0] * oblate->pole[0] + r[1] * oblate->pole[1] + r[2] * oblate->pole[2];
            const double p2 = 1.5 * z * z / r2 - 0.5;
            total += solar_body_mass_kg(other) * gm_i * oblate->j2 * oblate->j2_radius_m * oblate->j2_radius_m
                     * p2 / (r2 * sqrt(r2));
        }
    }
    return total;
}

double solar_body_mass_kg(const SolarBody *body) {
    return body == NULL ? 0.0 : active_gm(body) / SOLAR_G;
}

const SolarBody *solar_system_body(const SolarSystem *system, SolarBodyId id) {
    if (system == NULL || (int)id < 0 || id >= SOLAR_CATALOG_COUNT) return NULL;
    for (size_t index = 0; index < system->body_count; ++index) {
        if (system->bodies[index].id == (int)id) return &system->bodies[index];
    }
    return NULL;
}
