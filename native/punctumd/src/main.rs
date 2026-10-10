use std::io::{self, BufRead, Write};

// Reads requests from stdin, one per line, and answers each on its own line,
// in order, until stdin closes (the bar went away). See docs/native.md.
fn main() {
    // Panics are caught per request and reported in the reply; keep them off
    // stderr, which the bar logs.
    std::panic::set_hook(Box::new(|_| {}));
    let stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    let mut state = punctumd::State::new();
    for line in stdin.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = punctumd::handle(&line, &mut state);
        if writeln!(stdout, "{reply}").and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}
