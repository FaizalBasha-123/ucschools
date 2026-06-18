use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestStruct {
    my_field: String,
}
fn main() {
    let t = TestStruct { my_field: "hello".into() };
    println!("{}", serde_json::to_string(&t).unwrap());
}
