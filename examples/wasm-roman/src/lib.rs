//! Roman numerals, both ways: `roman 2026` → MMXXVI, `roman mmxxvi` → 2026.
//! The smallest useful WebAssembly extension, to copy from. It sees only the
//! query, its settings and the time, and answers with rows; see
//! docs/wasm.md and native/punctumd/wit/extension.wit.

wit_bindgen::generate!({ path: "../../native/punctumd/wit", world: "extension" });

use punctum::extension::types::{Action, Row};

struct Roman;

const NUMERALS: [(u32, &str); 13] = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
    (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
];

fn to_roman(mut n: u32) -> String {
    let mut out = String::new();
    for (value, letters) in NUMERALS {
        while n >= value {
            out.push_str(letters);
            n -= value;
        }
    }
    out
}

/// The number a numeral stands for, if it's written the standard way.
fn from_roman(text: &str) -> Option<u32> {
    let upper = text.to_ascii_uppercase();
    let mut n = 0;
    let mut rest = upper.as_str();
    for (value, letters) in NUMERALS {
        while let Some(after) = rest.strip_prefix(letters) {
            n += value;
            rest = after;
        }
    }
    (rest.is_empty() && n > 0 && to_roman(n) == upper).then_some(n)
}

fn row(title: String, subtitle: &str) -> Row {
    Row {
        copy: title.clone(),
        run: Some(Action::Copy(title.clone())),
        title,
        subtitle: subtitle.into(),
        icon: "󰎤".into(),
        score: 97.0,
        alt: None,
        swatch: None,
        group: None,
        complete: None,
    }
}

impl Guest for Roman {
    fn respond(query: String, _settings: String, _now_ms: i64) -> Answer {
        let text = query.trim_start().strip_prefix("roman").unwrap_or("").trim();
        let rows = if text.is_empty() {
            vec![Row { copy: String::new(), run: None, ..row("Type a number or a numeral".into(), "Roman numerals") }]
        } else if let Ok(n) = text.parse::<u32>() {
            if (1..4000).contains(&n) {
                vec![row(to_roman(n), &format!("{n} in Roman numerals"))]
            } else {
                vec![Row { copy: String::new(), run: None, ..row("From 1 to 3999".into(), "Roman numerals") }]
            }
        } else if let Some(n) = from_roman(text) {
            vec![row(n.to_string(), &format!("{} as a number", text.to_ascii_uppercase()))]
        } else {
            vec![]
        };
        Answer { rows, ttl_ms: None }
    }
}

export!(Roman);
