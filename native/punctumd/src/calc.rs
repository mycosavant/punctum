//! The calculator. A port of lib/Calc.js and extensions/math/provider.js: a
//! tokenizer and a recursive-descent parser, never an eval.
//!
//!   expr    := term (("+" | "-") term)*          a + b% means a * (1 + b/100)
//!   term    := unary (("*" | "/" | "mod" | "of" | implicit) unary)*
//!   unary   := ("-" | "+") unary | power
//!   power   := postfix ("^" unary)?              right-associative; -2^2 = -4
//!   postfix := primary ("%" | "!")*
//!   primary := number | constant | func "(" args ")" | "(" expr ")"
//!
//! What it reads, and every answer, is the JS's. Its functions come from the
//! libm crate, a port of the same fdlibm that JavaScript's Math is built on,
//! so sin(2) agrees to the last bit.
//!
//! What the parser can't read, fend (fend-core, an arbitrary-precision
//! calculator) may still answer: `100!`, `2^200`, `0xff + 1`, `255 to hex`,
//! `sqrt(-4)`. Only a plain number counts (a unit or currency answer is the
//! units and currency extensions' to give), and it ranks below the parser's
//! answers.

use std::time::{Duration, Instant};

use crate::format::{format, js_round, plain, to_precision};
use crate::{Answer, Context, Extension, Row};

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Const(f64),
    Fn(&'static str),
    Op(&'static str),
    Open,
    Close,
    Comma,
}

const PI: f64 = std::f64::consts::PI;

fn constant(word: &str) -> Option<f64> {
    Some(match word {
        "pi" | "π" => PI,
        "e" => std::f64::consts::E,
        "tau" => PI * 2.0,
        _ => return None,
    })
}

const FUNCTIONS: [&str; 18] = [
    "sqrt", "cbrt", "abs", "round", "floor", "ceil", "log", "ln", "log2", "exp", "sin", "cos", "tan", "asin", "acos",
    "atan", "min", "max",
];

/// JavaScript's Math.min / Math.max: NaN wins, and -0 is below +0.
fn js_min_max(args: &[f64], max: bool) -> f64 {
    let mut out = if max { f64::NEG_INFINITY } else { f64::INFINITY };
    for &a in args {
        if a.is_nan() {
            return f64::NAN;
        }
        let better = if max {
            a > out || (a == 0.0 && out == 0.0 && out.is_sign_negative() && a.is_sign_positive())
        } else {
            a < out || (a == 0.0 && out == 0.0 && out.is_sign_positive() && a.is_sign_negative())
        };
        if better {
            out = a;
        }
    }
    out
}

fn call(name: &str, args: &[f64]) -> f64 {
    let x = args[0];
    match name {
        "sqrt" => x.sqrt(),
        "cbrt" => libm::cbrt(x),
        "abs" => x.abs(),
        "round" => js_round(x),
        "floor" => x.floor(),
        "ceil" => x.ceil(),
        "log" => libm::log(x) / std::f64::consts::LN_10,
        "ln" => libm::log(x),
        "log2" => libm::log(x) / std::f64::consts::LN_2,
        "exp" => libm::exp(x),
        "sin" => libm::sin(x),
        "cos" => libm::cos(x),
        "tan" => libm::tan(x),
        "asin" => libm::asin(x),
        "acos" => libm::acos(x),
        "atan" => libm::atan(x),
        "min" => js_min_max(args, false),
        _ => js_min_max(args, true),
    }
}

fn op(c: char) -> Option<&'static str> {
    Some(match c {
        '+' => "+",
        '-' | '−' => "-",
        '*' | '×' => "*",
        '/' | '÷' => "/",
        '^' => "^",
        '%' => "%",
        '!' => "!",
        _ => return None,
    })
}

fn word_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == 'π' || c == 'Π'
}

fn tokenize(src: &[char]) -> Option<Vec<Tok>> {
    let mut tokens: Vec<Tok> = Vec::new();
    let mut parens: Vec<bool> = Vec::new(); // true for a function-call paren, where "," separates args
    let mut i = 0;
    let at = |i: usize| src.get(i).copied();
    while i < src.len() {
        let c = src[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        if c.is_ascii_digit() || c == '.' {
            let mut num = String::new();
            while let Some(ch) = at(i) {
                if ch.is_ascii_digit() || ch == '.' {
                    num.push(ch);
                    i += 1;
                    continue;
                }
                if ch == '_' && at(i + 1).is_some_and(|d| d.is_ascii_digit()) {
                    i += 1;
                    continue;
                }
                // "1,000" is a thousands separator unless we're inside min(…)/max(…).
                let in_call = parens.last().copied().unwrap_or(false);
                if ch == ','
                    && !in_call
                    && (1..=3).all(|k| at(i + k).is_some_and(|d| d.is_ascii_digit()))
                    && !at(i + 4).is_some_and(|d| d.is_ascii_digit())
                {
                    i += 1;
                    continue;
                }
                if (ch == 'e' || ch == 'E') && {
                    let sign = matches!(at(i + 1), Some('+' | '-'));
                    at(i + 1 + sign as usize).is_some_and(|d| d.is_ascii_digit())
                } {
                    num.push('e');
                    i += 1;
                    if let Some(s @ ('+' | '-')) = at(i) {
                        num.push(s);
                        i += 1;
                    }
                    continue;
                }
                break;
            }
            if !valid_number(&num) {
                return None;
            }
            tokens.push(Tok::Num(num.parse().ok()?));
            continue;
        }

        // "3x4" / "3 x 4": a lone x after an operand is multiplication, not a word.
        if (c == 'x' || c == 'X')
            && matches!(tokens.last(), Some(Tok::Num(_) | Tok::Const(_) | Tok::Close))
            && !at(i + 1).is_some_and(|n| n.is_ascii_alphabetic())
        {
            tokens.push(Tok::Op("*"));
            i += 1;
            continue;
        }

        if word_start(c) {
            let mut word = String::new();
            while let Some(ch) = at(i).filter(|ch| word_start(*ch) || ch.is_ascii_digit()) {
                word.push(if ch == 'Π' { 'π' } else { ch.to_ascii_lowercase() });
                i += 1;
            }
            if word == "mod" || word == "of" {
                tokens.push(Tok::Op(if word == "mod" { "mod" } else { "of" }));
            } else if let Some(f) = FUNCTIONS.iter().find(|f| **f == word) {
                tokens.push(Tok::Fn(f));
            } else if let Some(v) = constant(&word) {
                tokens.push(Tok::Const(v));
            } else {
                return None;
            }
            continue;
        }

        match c {
            '(' => {
                parens.push(matches!(tokens.last(), Some(Tok::Fn(_))));
                tokens.push(Tok::Open);
            }
            ')' => {
                parens.pop();
                tokens.push(Tok::Close);
            }
            ',' => tokens.push(Tok::Comma),
            _ => {
                let o = op(c)?;
                if c == '*' && at(i + 1) == Some('*') {
                    tokens.push(Tok::Op("^"));
                    i += 1;
                } else {
                    tokens.push(Tok::Op(o));
                }
            }
        }
        i += 1;
    }
    Some(tokens)
}

/// `^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$`
fn valid_number(num: &str) -> bool {
    let (mantissa, exp) = match num.split_once('e') {
        Some((m, e)) => (m, Some(e)),
        None => (num, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let mantissa_ok = match mantissa.split_once('.') {
        Some((a, b)) => (digits(a) && (b.is_empty() || digits(b))) || (a.is_empty() && digits(b)),
        None => digits(mantissa),
    };
    let exp_ok = exp.is_none_or(|e| digits(e.strip_prefix(['+', '-']).unwrap_or(e)));
    mantissa_ok && exp_ok
}

#[derive(Clone, Copy)]
struct Val {
    v: f64,
    pct: bool,
}

fn val(v: f64) -> Val {
    Val { v, pct: false }
}

struct Parser {
    tokens: Vec<Tok>,
    pos: usize,
    saw_operation: bool,
}

type Parsed = Option<Val>;

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    fn is_op(&self, v: &str) -> bool {
        matches!(self.peek(), Some(Tok::Op(o)) if *o == v)
    }

    fn starts_operand(tok: Option<&Tok>) -> bool {
        matches!(tok, Some(Tok::Num(_) | Tok::Const(_) | Tok::Fn(_) | Tok::Open))
    }

    fn expr(&mut self) -> Parsed {
        let mut left = self.term()?;
        while self.is_op("+") || self.is_op("-") {
            let Some(Tok::Op(o)) = self.next() else { return None };
            let right = self.term()?;
            self.saw_operation = true;
            left = if right.pct {
                let factor = if o == "+" { 1.0 + right.v } else { 1.0 - right.v };
                val(left.v * factor)
            } else {
                val(if o == "+" { left.v + right.v } else { left.v - right.v })
            };
        }
        Some(left)
    }

    fn term(&mut self) -> Parsed {
        let mut left = self.unary()?;
        loop {
            let o = match self.peek() {
                Some(Tok::Op(o @ ("*" | "/" | "mod" | "of"))) => {
                    let o = *o;
                    self.pos += 1;
                    o
                }
                t if Self::starts_operand(t) => "*", // implicit: 2pi, 3(4+1)
                _ => break,
            };
            let right = self.unary()?;
            self.saw_operation = true;
            left = val(match o {
                "*" | "of" => left.v * right.v,
                "/" => left.v / right.v,
                _ => ((left.v % right.v) + right.v) % right.v,
            });
        }
        Some(left)
    }

    fn unary(&mut self) -> Parsed {
        if self.is_op("-") {
            self.pos += 1;
            let v = self.unary()?;
            return Some(Val { v: -v.v, pct: v.pct });
        }
        if self.is_op("+") {
            self.pos += 1;
            return self.unary();
        }
        self.power()
    }

    fn power(&mut self) -> Parsed {
        let base = self.postfix()?;
        if self.is_op("^") {
            self.pos += 1;
            let exp = self.unary()?;
            self.saw_operation = true;
            return Some(val(js_pow(base.v, exp.v)));
        }
        Some(base)
    }

    fn postfix(&mut self) -> Parsed {
        let mut v = self.primary()?;
        loop {
            if self.is_op("%") {
                // "%" is a percentage unless an operand follows it, then it's modulo.
                if Self::starts_operand(self.tokens.get(self.pos + 1)) {
                    self.pos += 1;
                    let rhs = self.power()?;
                    self.saw_operation = true;
                    v = val(((v.v % rhs.v) + rhs.v) % rhs.v);
                    continue;
                }
                self.pos += 1;
                self.saw_operation = true;
                v = Val { v: v.v / 100.0, pct: true };
            } else if self.is_op("!") {
                self.pos += 1;
                self.saw_operation = true;
                v = val(factorial(v.v)?);
            } else {
                return Some(v);
            }
        }
    }

    fn primary(&mut self) -> Parsed {
        match self.next()? {
            Tok::Num(n) => Some(val(n)),
            Tok::Const(c) => {
                self.saw_operation = true;
                Some(val(c))
            }
            Tok::Open => {
                let inner = self.expr()?;
                (self.next()? == Tok::Close).then_some(val(inner.v))
            }
            Tok::Fn(name) => {
                self.saw_operation = true;
                if self.next()? != Tok::Open {
                    return None;
                }
                let mut args = vec![self.expr()?.v];
                while self.peek() == Some(&Tok::Comma) {
                    self.pos += 1;
                    args.push(self.expr()?.v);
                }
                (self.next()? == Tok::Close).then(|| val(call(name, &args)))
            }
            _ => None,
        }
    }
}

/// JavaScript's `**`, which differs from C's pow where 1 meets NaN or ∞.
fn js_pow(base: f64, exp: f64) -> f64 {
    if exp.is_nan() || (base.abs() == 1.0 && exp.is_infinite()) {
        return f64::NAN;
    }
    libm::pow(base, exp)
}

fn factorial(n: f64) -> Option<f64> {
    if n < 0.0 || n != n.floor() || n > 170.0 {
        return None;
    }
    let mut r = 1.0;
    let mut i = 2.0;
    while i <= n {
        r *= i;
        i += 1.0;
    }
    Some(r)
}

/// The value and whether it's trivial (a bare number, which the calculator
/// doesn't echo back), or None when the text isn't a complete expression.
pub fn evaluate(src: &str) -> Option<(f64, bool)> {
    let text: Vec<char> = src.trim().chars().collect();
    if text.is_empty() {
        return None;
    }
    let tokens = tokenize(&text)?;
    // The parser recurses about once a token; past this, a pasted wall of
    // brackets or minus signs would overflow the stack and take the whole
    // daemon with it. No sum anyone types is this long.
    if tokens.is_empty() || tokens.len() > MAX_TOKENS {
        return None;
    }
    let mut p = Parser { tokens, pos: 0, saw_operation: false };
    let result = p.expr()?;
    if p.pos != p.tokens.len() || result.v.is_nan() {
        return None;
    }
    Some((result.v, !p.saw_operation))
}

const MAX_TOKENS: usize = 512;
/// fend recurses without a limit and reads a long number without checking
/// its deadline, so it's only given what a person would type.
const FEND_MAX_CHARS: usize = 160;
const FEND_MAX_DEPTH: usize = 32;

fn nesting(text: &str) -> usize {
    let (mut depth, mut most) = (0usize, 0usize);
    for c in text.chars() {
        match c {
            '(' | '[' | '{' => {
                depth += 1;
                most = most.max(depth);
            }
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    most
}

/// What fend makes of a text the parser can't read: a plain number, or None.
/// Given 50 ms, so `9^9^9` can't hold up the keystroke.
fn fend(text: &str) -> Option<String> {
    if !text.bytes().any(|b| b.is_ascii_digit())
        || text.chars().count() > FEND_MAX_CHARS
        || nesting(text) > FEND_MAX_DEPTH
    {
        return None;
    }
    struct Deadline(Instant);
    impl fend_core::Interrupt for Deadline {
        fn should_interrupt(&self) -> bool {
            Instant::now() >= self.0
        }
    }
    let mut ctx = fend_core::Context::new();
    let deadline = Deadline(Instant::now() + Duration::from_millis(50));
    let result = fend_core::evaluate_with_interrupt(text, &mut ctx, &deadline).ok()?;
    let out = result.get_main_result().trim();
    let number = out.strip_prefix("approx. ").unwrap_or(out);
    let plain = |s: &str| {
        let s = s.strip_prefix('-').unwrap_or(s);
        !s.is_empty()
            && (s.bytes().all(|b| b.is_ascii_digit() || b == b'.' || b == b',')
                || s.strip_prefix("0x").is_some_and(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_hexdigit()))
                || s.strip_prefix("0b").is_some_and(|h| !h.is_empty() && h.bytes().all(|b| b == b'0' || b == b'1'))
                || s.strip_prefix("0o").is_some_and(|h| !h.is_empty() && h.bytes().all(|b| (b'0'..=b'7').contains(&b))))
    };
    let complex = number
        .strip_suffix('i')
        .is_some_and(|re| re.split([' ', '+']).filter(|p| !p.is_empty() && *p != "-").all(|p| plain(p)));
    (plain(number) || complex).then(|| out.to_string())
}

pub struct Calc;

impl Extension for Calc {
    fn id(&self) -> &'static str {
        "math"
    }

    fn matches(&self, query: &str, ctx: &Context) -> Answer {
        // One "=" at the end, as typed to ask for the answer.
        let text = match query.trim_end().strip_suffix('=') {
            Some(t) => t,
            None => query,
        };
        let Some((value, trivial)) = evaluate(text) else {
            return match fend(text.trim()) {
                Some(answer) => vec![Row {
                    subtitle: format!("= {} · fend", text.trim()),
                    copy: answer.strip_prefix("approx. ").unwrap_or(&answer).to_string(),
                    title: answer,
                    score: 70.0,
                    ..Default::default()
                }]
                .into(),
                None => Answer::default(),
            };
        };
        if trivial {
            return Answer::default();
        }
        if !value.is_finite() {
            return vec![Row {
                title: if value > 0.0 { "∞" } else { "-∞" }.into(),
                subtitle: "Calculator".into(),
                score: 60.0,
                copy: if value > 0.0 { "Infinity" } else { "-Infinity" }.into(),
                ..Default::default()
            }]
            .into();
        }
        // toPrecision takes 1 to 100; anything else is the JS's RangeError,
        // which answers nothing. 0, null and the like mean 10.
        let precision = match ctx.settings.get("precision") {
            None | Some(serde_json::Value::Null) | Some(serde_json::Value::Bool(false)) => 10,
            Some(v) => match v.as_f64() {
                Some(p) if p == 0.0 || p.is_nan() => 10,
                Some(p) if (1.0..101.0).contains(&p) => p as usize,
                _ => return Answer::default(),
            },
        };
        let rounded = to_precision(value, precision);
        vec![Row {
            title: format(rounded),
            subtitle: format!("= {}", text.trim()),
            score: 80.0,
            copy: plain(rounded),
            ..Default::default()
        }]
        .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(q: &str) -> Vec<Row> {
        let ctx =
            Context::new(&serde_json::Value::Null, jiff::Timestamp::now(), jiff::tz::TimeZone::UTC, &crate::NO_DATA);
        Calc.matches(q, &ctx).rows
    }

    fn title(q: &str) -> String {
        ask(q).first().map(|r| r.title.clone()).unwrap_or_default()
    }

    #[test]
    fn the_js_grammar() {
        assert_eq!(title("12*8 + 15%"), "110.4");
        assert_eq!(title("15% of 200"), "30");
        assert_eq!(title("5!"), "120");
        assert_eq!(title("-2^2"), "-4");
        assert_eq!(title("2^3^2"), "512");
        assert_eq!(title("3x4"), "12");
        assert_eq!(title("2pi"), "6.283185307");
        assert_eq!(title("1,000 * 2"), "2,000");
        assert_eq!(title("max(1,2,3)"), "3");
        assert_eq!(title("10 % 3"), "1");
        assert_eq!(title("7 mod -3"), "-2");
        assert_eq!(title("2 ** 10 ="), "1,024");
        assert_eq!(title("1/0"), "∞");
        assert!(ask("42").is_empty());
        assert!(ask("hello").is_empty());
        assert!(ask("5 min").is_empty());
    }

    #[test]
    fn fend_answers_what_the_parser_cannot_with_numbers_only() {
        assert_eq!(title("0xff + 1"), "0x100");
        assert_eq!(title("171!").len() > 300, true);
        assert_eq!(ask("0xff + 1")[0].subtitle, "= 0xff + 1 · fend");
        assert!(ask("5 km to mi").is_empty());
        assert!(ask("100 usd to eur").is_empty());
        assert!(ask("today").is_empty());
    }

    #[test]
    fn walls_of_brackets_and_long_numbers_answer_nothing_quickly() {
        let t = std::time::Instant::now();
        assert!(ask(&"(".repeat(3500)).is_empty());
        assert!(ask(&format!("{}1+1{}", "(".repeat(50_000), ")".repeat(50_000))).is_empty());
        assert!(ask(&format!("{}1", "-".repeat(100_000))).is_empty());
        assert!(ask(&format!("{} + 1x", "1".repeat(100_000))).is_empty());
        assert!(t.elapsed().as_secs() < 2, "{:?}", t.elapsed());
        assert_eq!(title("((((1+2))))"), "3");
    }
}
