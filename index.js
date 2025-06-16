import { TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { ddbClient } from "./ddbClient.js";
import kuuid from "kuuid";

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
            dueDay,        // Integer between 1-28
            amount,
            rate,
            notes
        } = payload;

        // Validate dueDay
        if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
            return respond(400, {
                message: "Whoa! 'dueDay' must be between 1 and 28. Time travel isn’t supported (yet)."
            });
        }

        const result = await createLoan(customerId, dueDay, amount, rate, notes);

        if (!result.status) {
            return respond(400, { message: result.message });
        }

        return respond(200, {
            message: "Loan record saved successfully",
            loanId: result.loanId
        });
    } catch (error) {
        console.error("Handler Error:", error);
        return respond(400, error.message);
    }
};

async function createLoan(customerId, dueDay, amount, rate, notes) {
    const returnValue = { status: false, message: null, loanId: null };

    try {
        const loanId = kuuid.id({ random: 4, millisecond: true });
        const createdAt = new Date().toISOString();

        // Keys
        const PK_loan = `LOAN#${dueDay}`;
        const SK_loan = `CUSTOMER#${customerId}#LOAN#${loanId}`;

        const loanInfo = {
            amount,
            rate,
            createdAt,
            status: "ACTIVE",
            notes: notes || null
        };

        const transaction = {
            TransactItems: [
                // Main loan record
                {
                    Put: {
                        TableName: process.env.DYNAMODB_TABLE_NAME,
                        Item: marshall({
                            PK: PK_loan,
                            SK: SK_loan,
                            info: loanInfo
                        }),
                        ConditionExpression: "attribute_not_exists(PK)"
                    }
                },
                // Update CUSTOMER_LOOKUP to include new loan
                {
                    Update: {
                        TableName: process.env.DYNAMODB_TABLE_NAME,
                        Key: marshall({
                            PK: "CUSTOMER_LOOKUP",
                            SK: customerId
                        }),
                        UpdateExpression: "SET loans = list_append(if_not_exists(loans, :empty), :newLoan) ",
                        ExpressionAttributeValues: marshall({
                            ":empty": [],
                            ":newLoan": [
                                { loanId, dueDay }
                            ]
                        })
                    }
                }
            ]
        };

        await ddbClient.send(new TransactWriteItemsCommand(transaction));

        returnValue.status = true;
        returnValue.loanId = loanId;
        return returnValue;
    } catch (error) {
        console.error("Transaction Error:", error);
        returnValue.message = error.name === "TransactionCanceledException"
            ? "Loan creation failed due to conflict or invalid customer"
            : error.message;
        return returnValue;
    }
}
