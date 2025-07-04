import {
    GetItemCommand,
    PutItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ddbClient } from "./ddbClient.js";
import kuuid from "kuuid";

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;

export const handler = async (event) => {
    const respond = (statusCode, message) => ({
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*"
        },
        body: typeof message === "string" ? message : JSON.stringify(message)
    });

    try {
        const payload = JSON.parse(event.body);
        console.log("Payload:", payload);

        const {
            customerId,
            dueDay,
            amount,
            rate,
            interest,
            notes
        } = payload;

        const result = await createLoan(customerId, dueDay, amount, rate, interest, notes);

        if (!result.status) {
            return respond(400, { message: result.message });
        }

        return respond(200, {
            message: "Loan record saved successfully",
            loanId: result.loanId
        });
    } catch (error) {
        console.error("Handler Error:", error);
        return respond(500, { message: "Failed to create loan", error: error.message });
    }
};

async function createLoan(customerId, dueDay, amount, rate, interest, notes) {
    const returnValue = { status: false, message: null, loanId: null };

    try {
        const loanId = kuuid.id({ random: 4, millisecond: true });
        const createdAt = new Date().toISOString();

        const getCustomerCommand = new GetItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({
                PK: "CUSTOMER",
                SK: customerId
            })
        });

        const customerResult = await ddbClient.send(getCustomerCommand);

        if (!customerResult.Item) {
            returnValue.message = "Customer not found";
            return returnValue;
        }

        const customer = unmarshall(customerResult.Item);
        delete customer.PK;
        delete customer.SK;

        const PK = "LOAN";
        const SK = `CUSTOMER#${customerId}#LOAN#${loanId}`;

        const loanRecord = {
            PK,
            SK,
            loanId,
            customerId,
            dueDay,
            amount,
            rate,
            interest,
            notes: notes || null,
            createdAt,
            status: "ACTIVE",
            customer
        };

        const putCommand = new PutItemCommand({
            TableName: TABLE_NAME,
            Item: marshall(loanRecord),
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        });

        await ddbClient.send(putCommand);

        returnValue.status = true;
        returnValue.loanId = loanId;
        return returnValue;

    } catch (error) {
        console.error("PutItem Error:", error);
        returnValue.message = error.message;
        return returnValue;
    }
}
