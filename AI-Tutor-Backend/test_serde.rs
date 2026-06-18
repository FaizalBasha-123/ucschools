use serde::Serialize;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum TestEnum {
    Text {
        my_field: String,
    }
}

fn main() {
    let t = TestEnum::Text { my_field: "hello".into() };
    println!("{}", serde_json::to_string(&t).unwrap());
}
