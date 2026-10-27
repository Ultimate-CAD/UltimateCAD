// Parametric Box with Lid
//
// A demo model for the offline customizer. It exercises every widget type the
// parser supports, and splits its output across two plates using MakerWorld's
// `mw_plate_N()` convention so the plate switcher has something to show.

/* [Size] */

// Outside width
width = 60; // [20:1:200]

// Outside depth
depth = 40; // [20:1:200]

// Outside height, lid excluded
height = 30; // [10:1:150]

// Wall thickness
wall = 2; // [1:0.2:6]

/* [Shape] */

// Corner rounding
corner_radius = 3; // [0:0.5:20]

// Chamfer the bottom edge so the print needs no brim
chamfer_base = true;

// How the lid meets the box
lid_style = "lip"; // [lip:Inset lip, flat:Flat, none:No lid]

// Clearance between lid lip and box wall
lid_clearance = 0.25; // [0:0.05:0.8]

/* [Dividers] */

// Compartments across the width
columns = 1; // [1:6]

// Compartments across the depth
rows = 1; // [1:6]

// Divider thickness
divider_thickness = 1.6; // [0.8:0.2:4]

/* [Lid Text] */

// Text embossed on the lid. Leave empty for none.
lid_text = "PARTS";

// Text size
text_size = 8; // [3:0.5:24]

// How far the text stands up
text_depth = 0.6; // [0.2:0.1:2]

// Text font
text_font = "Liberation Sans:style=Bold";

/* [Placement] */

// Where the lid sits relative to the box when both are shown together
lid_offset = [0, 0, 0]; // [-150:150]

/* [Colours] */

// Box colour for 3MF export
box_colour = "#2d6cdf";

// Lid colour for 3MF export
lid_colour = "#f0f2f5";

/* [Hidden] */

$fn = 48;
EPS = 0.01;

inner_w = width - 2 * wall;
inner_d = depth - 2 * wall;
lid_thickness = max(wall, 1.6);
lip_height = lid_style == "lip" ? max(2, wall * 1.5) : 0;

module rounded_box(w, d, h, r) {
    radius = min(r, min(w, d) / 2 - 0.01);
    if (radius <= 0) {
        cube([w, d, h]);
    } else {
        linear_extrude(height = h)
            offset(r = radius) offset(delta = -radius)
                square([w, d]);
    }
}

module dividers() {
    // Interior walls are centred on each compartment boundary.
    if (columns > 1) {
        for (i = [1:columns - 1])
            translate([wall + inner_w * i / columns - divider_thickness / 2, wall, wall])
                cube([divider_thickness, inner_d, height - wall]);
    }
    if (rows > 1) {
        for (i = [1:rows - 1])
            translate([wall, wall + inner_d * i / rows - divider_thickness / 2, wall])
                cube([inner_w, divider_thickness, height - wall]);
    }
}

module box() {
    difference() {
        union() {
            rounded_box(width, depth, height, corner_radius);
        }

        // Interior cavity
        translate([wall, wall, wall])
            rounded_box(inner_w, inner_d, height, max(0, corner_radius - wall));

        // Recess for the lid's lip
        if (lid_style == "lip")
            translate([wall - lid_clearance, wall - lid_clearance, height - lip_height])
                rounded_box(
                    inner_w + 2 * lid_clearance,
                    inner_d + 2 * lid_clearance,
                    lip_height + EPS,
                    max(0, corner_radius - wall)
                );

        if (chamfer_base)
            difference() {
                translate([-EPS, -EPS, -EPS]) cube([width + 2 * EPS, depth + 2 * EPS, wall]);
                translate([0, 0, -EPS])
                    linear_extrude(height = wall + EPS, scale = 1)
                        offset(delta = -wall / 2) square([width, depth]);
            }
    }

    dividers();
}

module lid() {
    if (lid_style != "none") {
        difference() {
            union() {
                rounded_box(width, depth, lid_thickness, corner_radius);

                if (lid_style == "lip")
                    translate([wall - lid_clearance, wall - lid_clearance, lid_thickness - EPS])
                        rounded_box(
                            inner_w + 2 * lid_clearance - 0.1,
                            inner_d + 2 * lid_clearance - 0.1,
                            lip_height,
                            max(0, corner_radius - wall)
                        );
            }
        }

        if (len(lid_text) > 0)
            translate([width / 2, depth / 2, -text_depth + EPS])
                linear_extrude(height = text_depth)
                    text(lid_text, size = text_size, font = text_font,
                         halign = "center", valign = "center");
    }
}

// MakerWorld's Parametric Model Maker renders one plate per mw_plate_N module.
// The offline app follows the same convention.
module mw_plate_1() {
    color(box_colour) box();
}

module mw_plate_2() {
    color(lid_colour) lid();
}

// Shown together when no specific plate is selected.
mw_plate_1();

translate([0, depth + 10, 0] + lid_offset)
    mw_plate_2();
