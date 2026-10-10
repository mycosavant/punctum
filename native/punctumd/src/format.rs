//! Numbers the way the bar shows them, matching lib/Engine.js digit for digit
//! so a row reads the same whichever side made it.

/// JavaScript's `String(n)`: the shortest digits that read back as `n`, with
/// an exponent below 1e-6 and from 1e21 up. The copy text: no separators, so
/// it pastes cleanly into anything.
pub fn plain(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if n == 0.0 {
        return "0".into(); // String(-0) is "0"
    }
    let (digits, exp) = shortest(n.abs());
    let sign = if n < 0.0 { "-" } else { "" };
    if !(-6..21).contains(&exp) {
        return format!("{sign}{}", exponent_form(&digits, exp));
    }
    format!("{sign}{}", positional(&digits, exp))
}

/// Engine.js `format`: thousands separators, and six significant digits in
/// exponent form for the very large and very small.
pub fn format(n: f64) -> String {
    if !n.is_finite() {
        return plain(n);
    }
    let abs = n.abs();
    if abs != 0.0 && !(1e-6..1e15).contains(&abs) {
        // toPrecision(6), then /\.?0+e/ → "e"
        let (digits, exp) = rounded(abs, 6);
        let sign = if n < 0.0 { "-" } else { "" };
        return format!("{sign}{}", exponent_form(digits.trim_end_matches('0'), exp));
    }
    let s = plain(n);
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s.as_str()),
    };
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (s, None),
    };
    let mut out = String::with_capacity(s.len() + int.len() / 3 + 1);
    if neg {
        out.push('-');
    }
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if let Some(f) = frac {
        out.push('.');
        out.push_str(f);
    }
    out
}

/// JavaScript's `Math.round`: halves go up, towards +∞ (Rust's `round` takes
/// them away from zero, so -2.5 would be -3 rather than -2).
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// JavaScript's `Number(n.toPrecision(p))`.
pub fn to_precision(n: f64, p: usize) -> f64 {
    if n == 0.0 || !n.is_finite() || p == 0 {
        return n;
    }
    let (digits, exp) = rounded(n.abs(), p);
    let v: f64 = format!("0.{digits}e{}", exp + 1).parse().unwrap_or(n);
    if n < 0.0 { -v } else { v }
}

// Digits are a string of significant digits d1 d2 d3 … and `exp` the power of
// ten of d1, so 1234.5 is ("12345", 3) and 0.00012 is ("12", -4).

/// Every digit of a positive finite f64, exactly: none has more than 767
/// significant digits, so 800 places hold them all and a run of zeros after.
fn exact(abs: f64) -> (String, i32) {
    let s = format!("{abs:.800e}");
    let (m, e) = s.split_once('e').expect("exponent form");
    (m.replace('.', ""), e.parse().expect("exponent"))
}

/// Adds one to the last digit, carrying: ("1299", 2) → ("1300", 2), and
/// ("999", 2) → ("100", 3).
fn bump(digits: &str, exp: i32) -> (String, i32) {
    let mut d: Vec<u8> = digits.bytes().collect();
    for i in (0..d.len()).rev() {
        if d[i] == b'9' {
            d[i] = b'0';
        } else {
            d[i] += 1;
            return (String::from_utf8(d).expect("digits"), exp);
        }
    }
    d.insert(0, b'1');
    d.pop();
    (String::from_utf8(d).expect("digits"), exp + 1)
}

/// toPrecision's digits: the p nearest, an exact half going to the larger.
fn rounded(abs: f64, p: usize) -> (String, i32) {
    let (all, exp) = exact(abs);
    let kept = &all[..p];
    if all.as_bytes()[p] >= b'5' { bump(kept, exp) } else { (kept.to_string(), exp) }
}

/// Number::toString's digits: as few as read back as `abs`, and of two such
/// equally near it, the even one. Rust finds as few; it may pick the odd one
/// of a tie (198684442655728.125 → …728.13 where JavaScript says …728.12).
fn shortest(abs: f64) -> (String, i32) {
    let s = format!("{abs:e}");
    let (m, e) = s.split_once('e').expect("exponent form");
    let (digits, exp): (String, i32) = (m.replace('.', ""), e.parse().expect("exponent"));
    let k = digits.len();
    let (all, all_exp) = exact(abs);
    let tie = all_exp == exp && all.as_bytes()[k] == b'5' && all[k + 1..].bytes().all(|b| b == b'0');
    if !tie || digits.as_bytes()[k - 1] % 2 == 0 {
        return (digits, exp);
    }
    let lower = (all[..k].to_string(), exp);
    let other = if lower.0 == digits { bump(&lower.0, exp) } else { lower };
    let reads_back = exponent_form(&other.0, other.1).parse::<f64>() == Ok(abs);
    if reads_back { other } else { (digits, exp) }
}

/// "1.5e+21", "1e-7": JavaScript's exponent form.
fn exponent_form(digits: &str, exp: i32) -> String {
    let digits = if digits.is_empty() { "0" } else { digits };
    let (first, rest) = digits.split_at(1);
    let rest = rest.trim_end_matches('0');
    let sign = if exp < 0 { "-" } else { "+" };
    if rest.is_empty() { format!("{first}e{sign}{}", exp.abs()) } else { format!("{first}.{rest}e{sign}{}", exp.abs()) }
}

/// "1234.5", "0.00012", "1200": the digits without an exponent.
fn positional(digits: &str, exp: i32) -> String {
    if exp < 0 {
        return format!("0.{}{digits}", "0".repeat((-exp - 1) as usize));
    }
    let int_len = exp as usize + 1;
    if digits.len() <= int_len {
        return format!("{digits}{}", "0".repeat(int_len - digits.len()));
    }
    format!("{}.{}", &digits[..int_len], &digits[int_len..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_matches_javascript_string() {
        assert_eq!(plain(3.0), "3");
        assert_eq!(plain(3.1069), "3.1069");
        assert_eq!(plain(-0.0), "0");
        assert_eq!(plain(1e21), "1e+21");
        assert_eq!(plain(1.5e21), "1.5e+21");
        assert_eq!(plain(1e-7), "1e-7");
        assert_eq!(plain(0.000001), "0.000001");
        assert_eq!(plain(123456789012345680000.0), "123456789012345680000");
        assert_eq!(plain(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn format_matches_engine() {
        assert_eq!(format(10000.0), "10,000");
        assert_eq!(format(1073.7418), "1,073.7418");
        assert_eq!(format(-273.15), "-273.15");
        assert_eq!(format(999.0), "999");
        assert_eq!(format(-1234567.5), "-1,234,567.5");
        assert_eq!(format(1e15), "1e+15");
        assert_eq!(format(1.23456789e20), "1.23457e+20");
        assert_eq!(format(1e-7), "1e-7");
        assert_eq!(format(2.5e-9), "2.5e-9");
        assert_eq!(format(0.0), "0");
    }

    #[test]
    fn rounding_matches_javascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
        assert_eq!(to_precision(0.000123456, 4), 0.0001235);
        assert_eq!(to_precision(0.015625, 4), 0.01563); // a true tie: up, as in JS
        assert_eq!(to_precision(-0.015625, 4), -0.01563);
        assert_eq!(to_precision(0.99996, 4), 1.0);
        assert_eq!(format(1.000005e15), "1.00001e+15"); // a true tie at six digits: up
    }

    #[test]
    fn shortest_ties_go_to_even_as_in_javascript() {
        assert_eq!(plain(123456789012.0 * 1609.344), "198684442655728.12");
        assert_eq!(plain(0.5), "0.5");
        assert_eq!(plain(1200.0), "1200");
        assert_eq!(plain(-0.00012), "-0.00012");
    }
}
