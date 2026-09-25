#include "solar_system.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "horizons_reference.inc"

#define AU_M 149597870700.0
#define HOUR_S 3600.0
#define DAY_S 86400.0
#define DAYS_PER_YEAR 365.25

static void expect_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(EXIT_FAILURE);
    }
}

static double distance_between(const SolarBody *first, const SolarBody *second) {
    const double dx = first->position_m[0] - second->position_m[0];
    const double dy = first->position_m[1] - second->position_m[1];
    const double dz = first->position_m[2] - second->position_m[2];
    return sqrt(dx * dx + dy * dy + dz * dz);
}

static void total_momentum(const SolarSystem *system, double momentum[3], double *scale) {
    momentum[0] = momentum[1] = momentum[2] = 0.0;
    *scale = 0.0;
    for (size_t index = 0; index < system->body_count; ++index) {
        const SolarBody *body = &system->bodies[index];
        const double mass = solar_body_mass_kg(body);
        for (size_t axis = 0; axis < 3; ++axis) {
            momentum[axis] += mass * body->velocity_m_s[axis];
            *scale += fabs(mass * body->velocity_m_s[axis]);
        }
    }
}

static void test_catalog(void) {
    SolarSystem system;
    solar_system_init(&system);
    expect_true(system.body_count == SOLAR_CATALOG_COUNT, "catalog holds the Sun, 8 planets and 5 satellites");
    for (size_t index = 0; index < system.body_count; ++index) {
        const SolarBody *body = &system.bodies[index];
        const double pole = sqrt(body->pole[0] * body->pole[0] + body->pole[1] * body->pole[1] + body->pole[2] * body->pole[2]);
        expect_true(body->id == (int)index, "catalog index equals its id after init");
        expect_true(body->gm_m3_s2 > 0.0 && body->radius_m > 0.0, "catalog bodies have mass and size");
        expect_true(fabs(pole - 1.0) < 1e-12, "spin axes are unit vectors");
        expect_true(solar_system_body(&system, (SolarBodyId)index) == body, "lookup by id finds the body");
        for (size_t other = 0; other < index; ++other) {
            expect_true(strcmp(body->key, system.bodies[other].key) != 0, "body keys are unique");
        }
    }
    expect_true(system.bodies[SOLAR_MOON].parent == SOLAR_EARTH, "the Moon orbits Earth");
    for (int id = SOLAR_IO; id <= SOLAR_CALLISTO; ++id) {
        expect_true(system.bodies[id].parent == SOLAR_JUPITER, "Galilean satellites orbit Jupiter");
    }
    expect_true(system.bodies[SOLAR_EARTH].j2 > 0.0 && system.bodies[SOLAR_JUPITER].j2 > 0.0, "Earth and Jupiter are oblate");
    /* Jupiter's axis is tilted ~2.3 degrees from the ecliptic pole. */
    expect_true(system.bodies[SOLAR_JUPITER].pole[2] > cos(3.0 * 3.14159265358979 / 180.0), "Jupiter pole is near ecliptic north");
}

static void test_orbits_are_prograde(void) {
    SolarSystem system;
    solar_system_init(&system);
    for (size_t index = SOLAR_MERCURY; index < SOLAR_CATALOG_COUNT; ++index) {
        const SolarBody *body = &system.bodies[index];
        const SolarBody *primary = &system.bodies[body->parent < 0 ? SOLAR_SUN : body->parent];
        const double rx = body->position_m[0] - primary->position_m[0];
        const double ry = body->position_m[1] - primary->position_m[1];
        const double vx = body->velocity_m_s[0] - primary->velocity_m_s[0];
        const double vy = body->velocity_m_s[1] - primary->velocity_m_s[1];
        expect_true(rx * vy - ry * vx > 0.0, "every orbit is prograde about ecliptic north (+Z)");
    }
}

static void test_sun_earth_reference_distance(void) {
    SolarSystem system;
    solar_system_init_sun_earth(&system);
    const double actual = distance_between(&system.bodies[0], &system.bodies[1]);
    expect_true(system.body_count == 2, "two-body benchmark has two bodies");
    expect_true(fabs(actual - AU_M) / AU_M < 2.0e-7, "Sun-Earth reference distance is one astronomical unit");
}

static void run_two_body_year(SolarIntegrator integrator, double *energy_drift, double *radius_drift) {
    SolarSystem system;
    solar_system_init_sun_earth(&system);
    system.integrator = integrator;
    const double initial_energy = solar_system_total_energy_j(&system);
    const double initial_distance = distance_between(&system.bodies[0], &system.bodies[1]);
    *energy_drift = 0.0;
    *radius_drift = 0.0;
    for (size_t step = 0; step < (size_t)(DAYS_PER_YEAR * 24.0); ++step) {
        solar_system_step(&system, HOUR_S);
        const double energy = solar_system_total_energy_j(&system);
        const double distance = distance_between(&system.bodies[0], &system.bodies[1]);
        *energy_drift = fmax(*energy_drift, fabs((energy - initial_energy) / initial_energy));
        *radius_drift = fmax(*radius_drift, fabs(distance / initial_distance - 1.0));
    }
}

static void test_two_body_integrators(void) {
    double energy;
    double radius;
    run_two_body_year(SOLAR_INTEGRATOR_VELOCITY_VERLET, &energy, &radius);
    printf("two-body year, velocity Verlet: energy %.3e, radius %.3e\n", energy, radius);
    expect_true(energy < 2.0e-8, "Verlet one-year two-body energy drift stays below 2e-8");
    /* Verlet's O(dt^2) radius error at a one-hour step is about 3e-7. */
    expect_true(radius < 3.0e-7, "Verlet circular radius stays within 3e-7");

    run_two_body_year(SOLAR_INTEGRATOR_YOSHIDA4, &energy, &radius);
    printf("two-body year, Yoshida 4:       energy %.3e, radius %.3e\n", energy, radius);
    expect_true(energy < 1.0e-11, "4th-order one-year two-body energy drift stays below 1e-11");
    expect_true(radius < 1.0e-10, "4th-order circular radius stays within 1e-10");
}

static void test_full_system_conservation(void) {
    SolarSystem system;
    double momentum_before[3];
    double momentum_after[3];
    double scale;
    solar_system_init(&system);
    const double initial_energy = solar_system_total_energy_j(&system);
    total_momentum(&system, momentum_before, &scale);
    double maximum_drift = 0.0;
    for (int day = 0; day < 365; ++day) {
        expect_true(solar_system_advance(&system, DAY_S, SOLAR_DEFAULT_MAX_STEP_S) == 144, "a day is 144 ten-minute steps");
        const double energy = solar_system_total_energy_j(&system);
        expect_true(isfinite(energy), "full-system propagation stays finite");
        maximum_drift = fmax(maximum_drift, fabs((energy - initial_energy) / initial_energy));
    }
    total_momentum(&system, momentum_after, &scale);
    for (size_t axis = 0; axis < 3; ++axis) {
        expect_true(fabs(momentum_after[axis] - momentum_before[axis]) / scale < 1e-12, "linear momentum is conserved");
    }
    expect_true(fabs(system.simulation_time_s - 365.0 * DAY_S) < 1e-6, "advance keeps an exact clock");
    printf("14-body year (J2 on): max energy drift %.3e\n", maximum_drift);
    expect_true(maximum_drift < 1e-10, "14-body one-year energy drift stays below 1e-10");
}

static void test_replay_is_deterministic(void) {
    SolarSystem first;
    SolarSystem second;
    solar_system_init(&first);
    solar_system_init(&second);
    solar_system_advance(&first, 10.0 * DAY_S, SOLAR_DEFAULT_MAX_STEP_S);
    solar_system_advance(&second, 10.0 * DAY_S, SOLAR_DEFAULT_MAX_STEP_S);
    expect_true(memcmp(&first, &second, sizeof(first)) == 0, "identical runs are bit-for-bit identical");
}

/* Largest position error (m) against Horizons, and the index of that body. */
static double horizons_error(const SolarSystem *system, size_t reference, size_t index) {
    const double *expected = HORIZONS_REFERENCE_STATES[reference][index];
    const SolarBody *body = &system->bodies[index];
    const double dx = body->position_m[0] - expected[0];
    const double dy = body->position_m[1] - expected[1];
    const double dz = body->position_m[2] - expected[2];
    return sqrt(dx * dx + dy * dy + dz * dz);
}

static void propagate_to(SolarSystem *system, double day) {
    solar_system_advance(system, day * DAY_S - system->simulation_time_s, SOLAR_DEFAULT_MAX_STEP_S);
}

static void test_against_horizons(void) {
    /* Allowed position error (km) after 1 and 30 days. Differences come from
     * physics this core omits (relativity, asteroids, higher harmonics, tides)
     * against JPL's DE440/JUP365 integrations. */
    /* Measured 2026-09-23 (30 d): Mercury 8.8 (mostly relativity), Venus 1.7,
     * Earth 0.6, Moon 0.5, Io 78 (Jupiter J4+ and pole precession omitted),
     * Europa 9.4, Ganymede 0.5; the rest below 0.2. Limits keep ~2x margin. */
    static const double LIMIT_KM[2][SOLAR_CATALOG_COUNT] = {
        /* sun  mer   ven  ear  mar  jup  sat  ura  nep  moon io     eur   gan  cal */
        {  0.1, 0.1,  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,  6.0,  0.5,  0.1, 0.1 },
        {  0.1, 15.0, 3.0, 1.5, 0.5, 0.3, 0.1, 0.1, 0.1, 1.5,  150.0, 20.0, 1.5, 0.5 }
    };
    SolarSystem system;
    solar_system_init(&system);
    for (size_t reference = 0; reference < 2; ++reference) {
        propagate_to(&system, HORIZONS_REFERENCE_DAYS[reference]);
        printf("vs Horizons +%2.0f d (km):", HORIZONS_REFERENCE_DAYS[reference]);
        for (size_t index = 0; index < SOLAR_CATALOG_COUNT; ++index) {
            const double error_km = horizons_error(&system, reference, index) / 1000.0;
            printf(" %s %.2f", system.bodies[index].key, error_km);
            if (!(error_km < LIMIT_KM[reference][index])) {
                fprintf(stderr, "\n%s: %.3f km exceeds %.1f km\n", system.bodies[index].key, error_km, LIMIT_KM[reference][index]);
                expect_true(0, "propagated state must track JPL Horizons");
            }
        }
        printf("\n");
    }
}

static void test_jupiter_oblateness_matters(void) {
    /* Without J2, Io's orbit precesses and phases differently; the error
     * against Horizons after 30 days should grow by well over an order of
     * magnitude. This guards the sign and size of the J2 term. */
    SolarSystem with_j2;
    SolarSystem without_j2;
    solar_system_init(&with_j2);
    solar_system_init(&without_j2);
    without_j2.bodies[SOLAR_JUPITER].j2 = 0.0;
    propagate_to(&with_j2, HORIZONS_REFERENCE_DAYS[1]);
    propagate_to(&without_j2, HORIZONS_REFERENCE_DAYS[1]);
    const double error_with = horizons_error(&with_j2, 1, SOLAR_IO);
    const double error_without = horizons_error(&without_j2, 1, SOLAR_IO);
    printf("Io after 30 d: %.1f km with J2, %.1f km without\n", error_with / 1000.0, error_without / 1000.0);
    expect_true(error_without > 10.0 * error_with, "Jupiter J2 is required to follow Io");
}

static void test_massless_bodies_are_test_particles(void) {
    SolarSystem system;
    solar_system_init_sun_earth(&system);
    const SolarBody *sun = &system.bodies[0];
    const double radius = 1.52366231 * AU_M;
    const double speed = sqrt(sun->gm_m3_s2 / radius);
    SolarBody particle;
    memset(&particle, 0, sizeof(particle));
    particle.id = -1;
    particle.parent = 0;
    particle.key = "probe";
    particle.pole[2] = 1.0;
    /* Circular solar orbit at Mars' distance, opposite side from Earth. */
    particle.position_m[0] = sun->position_m[0] - radius;
    particle.velocity_m_s[0] = sun->velocity_m_s[0];
    particle.velocity_m_s[1] = sun->velocity_m_s[1] - speed;
    const int index = solar_system_add_body(&system, &particle);
    expect_true(index == 2, "add_body appends after the existing bodies");

    const double initial_energy = solar_system_total_energy_j(&system);
    double maximum_radial_drift = 0.0;
    for (int day = 0; day < 365; ++day) {
        solar_system_advance(&system, DAY_S, HOUR_S);
        const double distance = distance_between(&system.bodies[0], &system.bodies[index]);
        maximum_radial_drift = fmax(maximum_radial_drift, fabs(distance / radius - 1.0));
    }
    printf("massless probe one-year: max radius drift %.3e\n", maximum_radial_drift);
    expect_true(maximum_radial_drift < 1e-3, "a massless probe follows its solar orbit");
    const double energy = solar_system_total_energy_j(&system);
    expect_true(fabs((energy - initial_energy) / initial_energy) < 1e-10, "a test particle adds no energy");
}

static void test_add_body_validation(void) {
    SolarSystem system;
    SolarBody body;
    solar_system_init_empty(&system);
    memset(&body, 0, sizeof(body));
    body.id = -1;
    body.parent = -1;
    body.gm_m3_s2 = 1.0;
    body.parent = 0;
    expect_true(solar_system_add_body(&system, &body) == -1, "parent must reference an existing body");
    body.parent = -1;
    body.position_m[1] = NAN;
    expect_true(solar_system_add_body(&system, &body) == -1, "non-finite states are rejected");
    body.position_m[1] = 0.0;
    for (size_t index = 0; index < SOLAR_MAX_BODIES; ++index) {
        body.position_m[0] = (double)index * AU_M;
        expect_true(solar_system_add_body(&system, &body) == (int)index, "bodies can be added up to capacity");
    }
    expect_true(solar_system_add_body(&system, &body) == -1, "capacity is enforced");
    expect_true(solar_system_add_body(NULL, &body) == -1 && solar_system_add_body(&system, NULL) == -1, "NULL is rejected");
}

static void test_invalid_inputs_do_not_poison_state(void) {
    SolarSystem system;
    SolarSystem baseline;
    const double invalid_steps[] = {0.0, -1.0, NAN, INFINITY, -INFINITY};
    solar_system_init(&system);
    memcpy(&baseline, &system, sizeof(system));
    for (size_t index = 0; index < sizeof(invalid_steps) / sizeof(invalid_steps[0]); ++index) {
        solar_system_step(&system, invalid_steps[index]);
        expect_true(solar_system_advance(&system, invalid_steps[index], 600.0) == 0, "advance rejects invalid durations");
        expect_true(memcmp(&system, &baseline, sizeof(system)) == 0, "rejected input must not mutate any state bytes");
    }
    expect_true(solar_system_advance(&system, 1e12, 1e-3) == 0, "advance refuses absurd step counts");
    expect_true(memcmp(&system, &baseline, sizeof(system)) == 0, "a refused advance does not mutate state");
    expect_true(solar_system_advance(&system, 10.0, -5.0) == 1, "invalid max step falls back to the default");
    expect_true(solar_system_body(&system, (SolarBodyId)-1) == NULL, "negative body id is rejected");
    expect_true(solar_system_body(&system, SOLAR_CATALOG_COUNT) == NULL, "out-of-range body id is rejected");
    expect_true(solar_system_body(NULL, SOLAR_EARTH) == NULL, "null system lookup is rejected");
    expect_true(isnan(solar_system_total_energy_j(NULL)), "null energy returns NAN");
    expect_true(solar_body_mass_kg(NULL) == 0.0, "null body has no mass");
    solar_system_step(NULL, HOUR_S);
    expect_true(solar_system_advance(NULL, HOUR_S, 600.0) == 0, "null advance does nothing");
    solar_system_init(NULL);
    solar_system_init_empty(NULL);
    solar_system_init_sun_earth(NULL);
}

int main(void) {
    test_catalog();
    test_orbits_are_prograde();
    test_sun_earth_reference_distance();
    test_two_body_integrators();
    test_full_system_conservation();
    test_replay_is_deterministic();
    test_against_horizons();
    test_jupiter_oblateness_matters();
    test_massless_bodies_are_test_particles();
    test_add_body_validation();
    test_invalid_inputs_do_not_poison_state();
    puts("PASS: solar system core tests");
    return EXIT_SUCCESS;
}
