// The daemon as the bar sees it: lines in, lines out.
use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::Value;

fn talk(input: &str) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_punctumd"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("punctumd starts");
    child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

#[test]
fn hello_names_the_extensions() {
    let r = talk("{\"id\":0,\"op\":\"hello\"}\n");
    assert_eq!(r[0]["protocol"], 1);
    assert_eq!(r[0]["extensions"], serde_json::json!(["units", "time", "url", "colors"]));
}

#[test]
fn the_clock_and_zone_can_be_fixed_and_clock_answers_expire() {
    // 23 Sep 2026 14:00:30 in Colombo.
    let r = talk(concat!(
        r#"{"id":1,"ext":"time","query":"time in tokyo","settings":{"home":"Asia/Colombo"},"now":1790152230000,"local_zone":"Asia/Colombo"}"#,
        "\n",
        r#"{"id":2,"ext":"units","query":"5 km to mi"}"#,
        "\n",
    ));
    assert_eq!(r[0]["rows"][0]["title"], "17:30 Tokyo");
    assert_eq!(r[0]["ttl"], 30_000);
    assert!(r[1].get("ttl").is_none());
}

#[test]
fn answers_in_order_and_survives_bad_lines() {
    let r = talk(concat!(
        "{\"id\":1,\"ext\":\"units\",\"query\":\"5 km to mi\"}\n",
        "not json\n",
        "\n",
        "{\"id\":2,\"ext\":\"nope\",\"query\":\"x\"}\n",
        "{\"id\":\"three\",\"ext\":\"units\",\"query\":\"hello\"}\n",
    ));
    assert_eq!(r.len(), 4);
    assert_eq!(r[0]["id"], 1);
    assert_eq!(r[0]["rows"][0]["title"], "3.1069 mi");
    assert_eq!(r[0]["rows"][0]["copy"], "3.1069");
    assert!(r[1]["error"].as_str().unwrap().starts_with("unreadable request"));
    assert_eq!(r[2]["id"], 2);
    assert!(r[2]["error"].is_string());
    assert_eq!(r[3]["id"], "three");
    assert_eq!(r[3]["rows"], serde_json::json!([]));
}
