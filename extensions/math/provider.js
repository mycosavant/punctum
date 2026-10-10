.pragma library
.import "../../lib/Calc.js" as Calc

// Calculator. A tokenizer + recursive-descent parser — never eval().
//
//   expr    := term (("+" | "-") term)*          a + b% means a * (1 + b/100)
//   term    := unary (("*" | "/" | "mod" | "of" | implicit) unary)*
//   unary   := ("-" | "+") unary | power
//   power   := postfix ("^" unary)?              right-associative; -2^2 = -4
//   postfix := primary ("%" | "!")*
//   primary := number | constant | func "(" args ")" | "(" expr ")"
//
// This is the JS fallback for native/punctumd/src/calc.rs, used when punctumd
// isn't installed; tests/calc-parity.js keeps the two the same, so change
// both together (lib/Calc.js too, which the currency extension also uses).
// The Rust one also asks fend what the parser can't read, for a plain number.

var provider = {
  id: "math",
  name: "Calculator",
  icon: "󰃬",
  commands: [
    { title: "Calculator", keywords: "calculate calc math maths sum arithmetic", text: "Sums, percentages, powers, sqrt, pi", complete: "12*8 + 15%", select: true }
  ],
  help: [
    { id: "calc", title: "Calculator", about: "Sums, percentages, powers, sqrt and pi",
      examples: ["12*8 + 15%", "sqrt(2) * pi", "15% of 200", "5!"] }
  ],
  match: function(query, ctx) {
    var text = query.replace(/=\s*$/, "")
    var r = Calc.evaluate(text)
    if (!r || r.trivial) return []
    if (!isFinite(r.value)) {
      return [{ title: r.value > 0 ? "∞" : (r.value < 0 ? "-∞" : "undefined"), subtitle: "Calculator", score: 60, copy: String(r.value) }]
    }
    var precision = (ctx.settings && ctx.settings.precision) || 10
    var rounded = Number(r.value.toPrecision(precision))
    return [{
      title: ctx.format(rounded),
      subtitle: "= " + text.trim(),
      score: 80,
      copy: ctx.plain(rounded)
    }]
  }
}
