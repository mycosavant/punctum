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
    assert_eq!(
        r[0]["extensions"],
        serde_json::json!([
            "units",
            "time",
            "url",
            "colors",
            "apps",
            "windows",
            "hotkeys",
            "clipboard",
            "packages",
            "remind",
            "math",
            "files",
            "processes"
        ])
    );
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

#[test]
fn an_answer_says_which_loads_it_needs_and_uses_them_once_sent() {
    let r = talk(concat!(
        "{\"id\":1,\"ext\":\"packages\",\"query\":\"pkg kfind\"}\n",
        "{\"id\":2,\"op\":\"load\",\"ext\":\"packages\",\"key\":\"list\",\"text\":\"S\\textra\\tkfind\\t1-1\\tx86_64\\tFind files\"}\n",
        "{\"id\":3,\"ext\":\"packages\",\"query\":\"pkg kfind\"}\n",
        "{\"id\":4,\"op\":\"load\",\"ext\":\"packages\",\"key\":\"list\",\"text\":null}\n",
        "{\"id\":5,\"ext\":\"packages\",\"query\":\"pkg kfind\"}\n",
        "{\"id\":6,\"op\":\"load\",\"ext\":\"nope\",\"key\":\"list\",\"text\":\"x\"}\n",
        "{\"id\":7,\"op\":\"load\",\"ext\":\"packages\",\"key\":\"../x\",\"text\":\"x\"}\n",
        "{\"id\":8,\"ext\":\"units\",\"query\":\"5 km to mi\"}\n",
    ));
    assert_eq!(r[0]["rows"][0]["title"], "Reading the package list…");
    assert_eq!(r[0]["needs"], serde_json::json!(["list"]));
    assert_eq!(r[1]["ok"], true);
    assert_eq!(r[2]["rows"][0]["title"], "kfind");
    assert_eq!(r[2]["needs"], serde_json::json!(["list"]));
    // Dropped when the bar closes: asked for again.
    assert_eq!(r[4]["rows"][0]["title"], "Reading the package list…");
    assert!(r[5]["error"].is_string() && r[6]["error"].is_string());
    assert!(r[7].get("needs").is_none());
}

#[test]
fn a_line_that_is_not_utf8_or_not_a_request_is_answered_and_the_daemon_goes_on() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_punctumd"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("punctumd starts");
    let mut input = b"{\"id\":1,\"ext\":\"math\",\"query\":\"1+\xff\"}\n".to_vec();
    input
        .extend_from_slice(b"{\"id\":7,\"ext\":\"math\",\"query\":5}\n{\"id\":8,\"ext\":\"math\",\"query\":\"2+2\"}\n");
    child.stdin.take().unwrap().write_all(&input).unwrap();
    let out = child.wait_with_output().unwrap();
    let r: Vec<Value> =
        String::from_utf8(out.stdout).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(r.len(), 3);
    assert_eq!(r[1]["id"], 7);
    assert!(r[1]["error"].is_string());
    assert_eq!(r[2]["rows"][0]["title"], "4");
}
