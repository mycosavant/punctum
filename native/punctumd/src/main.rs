use std::io::{self, BufRead, Write};

// Reads requests from stdin, one per line, and answers each on its own line,
// in order, until stdin closes (the bar went away). See docs/native.md.
fn main() {
    // Panics are caught per request and reported in the reply; keep them off
    // stderr, which the bar logs.
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    let mut state = punctumd::State::new();
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match stdin.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        // A line that isn't UTF-8 is answered (with an error, as JSON can't
        // hold it), not the end of the daemon.
        let line = String::from_utf8_lossy(&raw);
        if line.trim().is_empty() {
            continue;
        }
        let reply = punctumd::handle(&line, &mut state);
        if writeln!(stdout, "{reply}").and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}
