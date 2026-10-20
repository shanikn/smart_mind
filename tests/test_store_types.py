from fastapi.testclient import TestClient

from agents.categorizer import STORE_TYPES, categorize, infer_store_type
from agents.pipeline import store_type
from api.main import app
from notepad import Note
from tests.support import delete_any  # noqa: E402

client = TestClient(app)


def test_store_types():
    assert STORE_TYPES == ("supermarket", "pharmacy", "post_office")


def test_food_and_groceries_go_to_the_supermarket():
    assert infer_store_type("buy milk") == "supermarket"
    assert infer_store_type("get carrots and bread") == "supermarket"
    assert infer_store_type("groceries for the weekend") == "supermarket"


def test_medicine_goes_to_the_pharmacy():
    assert infer_store_type("buy medicine for the flu") == "pharmacy"
    assert infer_store_type("get pills") == "pharmacy"
    assert infer_store_type("grab vitamins") == "pharmacy"
    assert infer_store_type("pick up my prescription") == "pharmacy"


def test_packages_and_mail_go_to_the_post_office():
    assert infer_store_type("pick up the package") == "post_office"
    assert infer_store_type("send the parcel to grandma") == "post_office"
    assert infer_store_type("buy stamps and send mail") == "post_office"
    assert infer_store_type("go to the post office") == "post_office"


def test_default_is_the_supermarket():
    assert infer_store_type("buy a birthday present") == "supermarket"


def test_store_errands_are_errands():
    assert categorize("send the parcel to grandma") == "errand"
    assert categorize("go to the pharmacy") == "errand"
    assert categorize("pick up my prescription") == "errand"


def test_only_errands_have_a_store_type():
    assert store_type(Note(content="buy medicine", category="errand")) == "pharmacy"
    assert store_type(Note(content="buy milk", category="errand")) == "supermarket"
    assert store_type(Note(content="call mom about the medicine", category="todo")) is None
    assert store_type(Note(content="idea: a mail app", category="idea")) is None


def test_list_notes_reports_the_store_type():
    errand = client.post("/notes/", json={"content": "buy vitamins"}).json()["id"]
    todo = client.post("/notes/", json={"content": "call mom"}).json()["id"]
    by_id = {n["_id"]: n for n in client.get("/notes/").json()}
    delete_any(errand)
    delete_any(todo)
    assert by_id[errand]["category"] == "errand"
    assert by_id[errand]["store_type"] == "pharmacy"
    assert by_id[todo]["store_type"] is None


# Hebrew shopping notes and notes naming a supermarket chain are errands, so
# they alert near any supermarket (Rami Levi included).
def test_hebrew_shopping_is_an_errand():
    for text in ("לקנות חלב", "קניות לשבת", "ללכת לסופר", "לקפוץ למכולת", "וגם לקנות לחם"):
        assert categorize(text) == "errand", text
        assert infer_store_type(text) == "supermarket", text


def test_supermarket_chains_are_errands():
    for text in ("Rami Levi: milk, bread", "rami levy tomorrow", "Shufersal - eggs",
                 "חלב ברמי לוי", "שופרסל: ביצים", "ביוחננוף", "אושר עד"):
        assert categorize(text) == "errand", text
        assert infer_store_type(text) == "supermarket", text


def test_hebrew_pharmacy_and_post_office():
    assert infer_store_type("לקנות תרופות") == "pharmacy"
    assert infer_store_type("לקנות ויטמינים בסופר פארם") == "pharmacy"
    assert categorize("בית מרקחת") == "errand"
    assert infer_store_type("לאסוף חבילה מהדואר") == "post_office"
    assert categorize("לאסוף חבילה מהדואר") == "errand"


def test_hebrew_words_inside_other_words_dont_count():
    # "סופרת" (counts) isn't "סופר", "קניונים" (malls) isn't "קניות"
    assert categorize("היא סופרת את הימים") == "todo"
    assert categorize("רשימת קניונים") == "todo"


# toiletries and cosmetics are drugstore (Super-Pharm) errands
def test_toiletries_go_to_the_drugstore():
    for text in ("buy face soap", "get shampoo and toothpaste", "sunscreen", "Super-Pharm: deodorant",
                 "superpharm", "לקנות סבון פנים", "שמפו ומרכך", "משחת שיניים", "קרם הגנה", "סופרפארם"):
        assert categorize(text) == "errand", text
        assert infer_store_type(text) == "pharmacy", text


def test_food_with_cream_stays_at_the_supermarket():
    assert infer_store_type("buy ice cream") == "supermarket"
    assert infer_store_type("לקנות שמנת") == "supermarket"


# The errand kind is shown as "Shopping": only things you get or send at a
# store. Going somewhere or chores aren't shopping and mustn't alert near
# supermarkets.
def test_chores_and_going_places_are_todos_not_shopping():
    for text in ("walk the dog", "take out the trash", "go to the bank", "pick up the kids",
                 "get the kids from school", "water the plants", "take the car to the garage",
                 "run errands"):
        assert categorize(text) == "todo", text


def test_buying_and_picking_up_things_is_still_shopping():
    for text in ("buy milk", "get carrots", "pick up Maybelline mascara", "pick up the package",
                 "go to the pharmacy", "go to the supermarket", "consider going to the store",
                 "take the parcel to the post office", "pick up my prescription"):
        assert categorize(text) == "errand", text
