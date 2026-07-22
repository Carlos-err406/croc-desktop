//! Human-friendly transfer codes: `NNNN-word-word-word` (mirrors croc's style).
//! croc accepts any code >= 6 chars.
use rand::seq::SliceRandom;
use rand::Rng;

const WORDS: &[&str] = &[
    "apple", "amber", "anchor", "arrow", "atlas", "aurora", "basil", "beacon", "birch", "bison",
    "bloom", "bridge", "cactus", "canyon", "cedar", "cobalt", "comet", "coral", "delta", "dune",
    "dusk", "ember", "falcon", "fern", "forest", "garnet", "glacier", "harbor", "hazel", "heron",
    "indigo", "ivory", "jade", "jasper", "kelp", "lagoon", "lark", "lotus", "lunar", "maple",
    "marble", "meadow", "nebula", "nectar", "oak", "onyx", "opal", "orbit", "otter", "pebble",
    "pine", "plume", "quartz", "quill", "raven", "reef", "ridge", "river", "saffron", "sage",
    "slate", "solar", "spruce", "summit", "tango", "thicket", "tidal", "topaz", "tundra", "umber",
    "valley", "vault", "verde", "violet", "walnut", "willow", "zenith", "zephyr",
];

pub fn generate_code() -> String {
    let mut rng = rand::thread_rng();
    // Four digits, first in 1-9 (no leading zero).
    let mut digits = String::from(char::from_digit(rng.gen_range(1..=9), 10).unwrap());
    for _ in 0..3 {
        digits.push(char::from_digit(rng.gen_range(0..=9), 10).unwrap());
    }
    let word = |rng: &mut rand::rngs::ThreadRng| *WORDS.choose(rng).unwrap();
    format!(
        "{}-{}-{}-{}",
        digits,
        word(&mut rng),
        word(&mut rng),
        word(&mut rng)
    )
}
