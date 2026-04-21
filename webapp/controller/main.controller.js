sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/UIComponent"
], function (Controller, Filter, FilterOperator, JSONModel, UIComponent) {
    "use strict";

    return Controller.extend("inspection.controller.main", {
        onInit: function () {
            this._oInspectionDataModel = new JSONModel({});
            this.getView().setModel(this._oInspectionDataModel, "inspection");

            this._oMainDataModel = this.getOwnerComponent().getModel();
            this._oMaintenanceOrderDataModel = this.getOwnerComponent().getModel("zui_maint_order_o4");
            this._oMeasurementdocumentDataModel = this.getOwnerComponent().getModel('measurementdocument');
            this._oInspectionLotDataModel = this.getOwnerComponent().getModel('ZZ1_INSPECTIONLOT_CDS');

            this._setInitialData();
            sap.ui.require(["sap/ushell/Container"], async function (Container) {
                const UserInfo = await Container.getServiceAsync("UserInfo");
                console.log( UserInfo.getId());
            });

            let oRouter = UIComponent.getRouterFor(this);
    
            if (oRouter) {
                let oRoute = oRouter.getRoute("Routemain"); 
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onObjectMatched, this);
                } else {
                    console.error("The route name 'Routemain' was not found in manifest.json");
                }
            }
            this._oMainDataModel.setSizeLimit(10000);

            const sToday = new Date().toISOString().split('T')[0];
            const oInput = this.byId("equipmentNumber");
    
            // Dynamically update the suggestion items path
            oInput.bindAggregation("suggestionItems", {
                path: "/EquipmentVH(P_KeyDate=" + sToday + ")/Set",
                template: new sap.ui.core.ListItem({
                    key: "{Equipment}",
                    text: "{Equipment}",
                    additionalText: "{EquipmentName}"
                })
            });
        },

        handleChange: function (oEvent) {
            let bValid = oEvent.getParameter("valid");
            if (!bValid) {
                oEvent.getSource().setValueState("Error");
            } else {
                oEvent.getSource().setValueState("None");
            }
        },

        onEquipmentChange: function(oEvent){
            let sEquipment = oEvent.getParameter("value");

            this._oInspectionDataModel.setProperty("/currentReading", null);
            this._oInspectionDataModel.setProperty("/latestReadingValue", null); // Clear the floor
            this._oInspectionDataModel.setProperty("/equipmentName", "");
            
            const oInput = this.byId("currentReading");
            oInput.setValueState("None"); // Remove any red error borders
            this.onValidateForm();

            if (sEquipment && sEquipment.trim() !== "") {
                sap.ui.core.BusyIndicator.show(0);

                this._getEquipment(sEquipment)
                    .then(oRes => {
                        if (oRes && oRes.equipment.EquipmentName) {
                            this._oInspectionDataModel.setProperty("/equipmentName", oRes.equipment.EquipmentName);

                            if (oRes && oRes.latestReading) {
                                // Data exists: set the values
                                this._oInspectionDataModel.setProperty("/latestReadingValue", oRes.latestReading.LastReading);
                                this._oInspectionDataModel.setProperty("/latestMeasuringPoint", oRes.latestReading.MeasuringPoint);  
                                this._oInspectionDataModel.setProperty("/latestMeasuringPointUoM", oRes.latestReading.UoM);
                            } else {
                                // Data does NOT exist: Clear fields and show the Toast
                                this._oInspectionDataModel.setProperty("/latestReadingValue", null);
                                this._oInspectionDataModel.setProperty("/latestMeasuringPoint", null);
                                
                                sap.m.MessageBox.error(`No Measurement Point assigned to Equipment (${oRes.equipment.Equipment}) ${oRes.equipment.EquipmentName}`);
                            }
                        } else {
                            // Handle case where equipment exists but has no name
                            this._oInspectionDataModel.setProperty("/equipmentName", "Name not found");
                        }
                    })
                    .catch(oErr => {
                        // Handle service errors (e.g., 404 Equipment not found)
                        this._oInspectionDataModel.setProperty("/equipmentName", "");
                        sap.m.MessageToast.show("Invalid Equipment Number");
                    })
                    .finally(() => {
                        // Always hide the indicator when the request finishes
                        sap.ui.core.BusyIndicator.hide();
                        // Trigger your validation logic to update the Next button
                        this.onValidateForm();
                    });
            } else {
                // Clear name if input is emptied
                this._oInspectionDataModel.setProperty("/equipmentName", "");
                this.onValidateForm();
            }
        },

        onCreate: async function() {
            const oModel = this._oInspectionDataModel;
            const sEquip = oModel.getProperty("/equipmentNumber");
            const sType = oModel.getProperty("/checklistType");

            sap.ui.core.BusyIndicator.show(0);

            try {
                // Create Maintenance Order
                const oOrderRes = await this._createMaintenanceOrder(sEquip, sType);
                const sOrderNum = oOrderRes.maintOrderNumber;

                // Create Measurement Document
                await this._createMeasurementDocument(sOrderNum);

                // Fetch Inspection Lot
                let sLotNum = "";
                try {
                    sLotNum = await this._getInspectionLot(sEquip, sOrderNum);
                } catch (e) {
                    // If Lot doesn't exist, we stop here and show an error
                    sap.ui.core.BusyIndicator.hide();
                    sap.m.MessageBox.error("Order created (" + sOrderNum + "), but no Inspection Lot was found for navigation.");
                    return; 
                }

                // Show Toast and Navigate
                sap.ui.core.BusyIndicator.hide();
                sap.m.MessageToast.show("Success! Redirecting to Inspection Results...", {
                    duration: 500,
                    onClose: function() {
                        this._navigateToInspectionResults(sLotNum);
                    }.bind(this)
                });

            } catch (oErr) {
                sap.ui.core.BusyIndicator.hide();
                this._displayError("Process failed at an early stage", oErr);
            }
        },

        onReadingChange: function(oEvent) {
            const fValue = oEvent.getParameter("value");
            const fMin = this._oInspectionDataModel.getProperty("/latestReadingValue");
            const oStepInput = oEvent.getSource();

            if (fValue < fMin) {
                oStepInput.setValueState("Error");
                oStepInput.setValueStateText("New reading must be greater than or equal to " + fMin);
            } else {
                oStepInput.setValueState("None");
            }

            this.onValidateForm(fValue);
        },

        onValidateForm: function(sCurrentReadingValue) {
            const oModel = this.getView().getModel("inspection");
            const oData = oModel.getData();
            const oBtnNext = this.byId("btnNext");

            // 1. Numeric Conversion for Reading
            const fCurrent = parseFloat(sCurrentReadingValue);
            const fMin = parseFloat(oData.latestReadingValue) || 0;

            // 2. Standard Field Validations
            const bIsDateValid = !!oData.date;
            const bIsEquipValid = !!(oData.equipmentNumber && oData.equipmentNumber.trim());
            const bIsTypeValid = !!(oData.checklistType && oData.checklistType !== "");
            // const bIsModelValid = !!(oData.modelNumber && oData.modelNumber.trim());

            // 3. Logic Validation for Reading
            // It must be a number, it must be > 0, and it must be >= the floor (fMin)
            const bIsReadingValid = !isNaN(fCurrent) && fCurrent > 0 && fCurrent >= fMin;
            const bMeasuringPoint = !!(oData.latestMeasuringPoint && oData.latestMeasuringPoint !== null);

            // 4. Final Boolean Combination
            const bFormValid = bIsDateValid && bIsEquipValid && bIsTypeValid && bIsReadingValid && bMeasuringPoint;

            // Update button state
            oBtnNext.setEnabled(!!bFormValid);
            oBtnNext.invalidate();
        },

        onCancel: function(oEvent){
            this._setInitialData();
        },

        _updateValueState: function(oControl) {
            // Simple visual helper
            if (typeof oControl.getValue === "function") {
                const sValue = oControl.getValue();
                oControl.setValueState(sValue ? "None" : "Error");
            }
        },

        _getEquipment: function(sEquipmentNumber) {
            return new Promise((resolve, reject) => {
                const oModel = this._oMainDataModel;

                // 1. STANDARD PADDING (for EquipmentVH)
                // '31200010' -> '000000000031200010'
                const sPaddedEquip = sEquipmentNumber.padStart(18, '0');
                
                // 2. PREFIX PADDING (for EquipmentReading)
                // '31200010' -> 'IE000000000031200010'
                const sPrefixEquip = "IE" + sPaddedEquip;
                // const sPath = `/EquipmentVH('${sPaddedEquip}')`;

                const sToday = new Date().toISOString().split('T')[0]; // Gets 2026-03-12
                const sPath = `/EquipmentVH(P_KeyDate=${sToday})/Set('${sPaddedEquip}')`;
                const oContextBinding = oModel.bindContext(sPath);

                oContextBinding.requestObject().then((oEquipData) => {
                    console.log("Equipment Header Found:", oEquipData);

                    const oListBinding = oModel.bindList("/EquipmentReading", null, null, [
                        new sap.ui.model.Filter("Equipment", sap.ui.model.FilterOperator.EQ, sPrefixEquip)
                    ], {
                        "$orderby": "MeasurementDocument desc"
                    });

                    // We request contexts without a length restriction in parameters,
                    // but we only ask for the first 10 contexts to keep it performant.
                    return oListBinding.requestContexts(0, 10).then((aContexts) => {
                        let oReadingData = null;
                        
                        // Even if we fetched 10, index 0 is the newest because of the $orderby
                        if (aContexts && aContexts.length > 0) {
                            oReadingData = aContexts[0].getObject();
                        }

                        resolve({
                            equipment: oEquipData,
                            latestReading: oReadingData
                        });
                    });

                }).catch((oError) => {
                    console.error("Fetch Error:", oError);
                    reject(oError);
                });
            });
        },

        _setInitialData: function(){
            let oDateFormat = sap.ui.core.format.DateFormat.getInstance({pattern: "yyyy-MM-dd"});
            let sDate = oDateFormat.format(new Date());
            this._oInspectionDataModel.setData({
                date: sDate,
                equipmentNumber: "",
                equipmentName: "",
                checklistType: "",
                // modelNumber: "",
                currentReading: 0
            });
        },

        _onObjectMatched: function (oEvent) {
            // This runs every time you navigate back to this screen
            console.log("App re-entered. Resetting data...");
            this._setInitialData();
            
            // Reset the button state
            if (this.byId("btnNext")) {
                this.byId("btnNext").setEnabled(false);
            }
        },

        _createMaintenanceOrder: function(sEquipmentNumber, sChecklistType) {
            return new Promise((resolve, reject) => {
                const oModel = this.getOwnerComponent().getModel();
                const sPaddedEquip = sEquipmentNumber.padStart(18, '0');
                
                const sUrl = "/sap/bc/http/sap/ZPM_MAINT_ORDER_SRV?sap-client=110";

                // SAPUI5's internal 'submitBatch' or metadata calls already have the token.
                // We will fetch a fresh one using the Model's headers if possible, 
                // or just let the proxy handle the injection.
                
                jQuery.ajax({
                    url: sUrl,
                    type: "POST",
                    contentType: "application/json",
                    xhrFields: {
                        withCredentials: true
                    },
                    headers: {
                        // Borrow the token UI5 already fetched for the OData service
                        "X-CSRF-Token": oModel.getHttpHeaders()["X-CSRF-Token"] || "Fetch"
                    },
                    data: JSON.stringify({
                        "Equipment": sPaddedEquip,
                        "CheckListType": sChecklistType
                    }),
                    success: (oResponse) => {
                        let oData = typeof oResponse === "string" ? JSON.parse(oResponse) : oResponse;
                        console.log("Maintenance Order created:", oData.maintOrderNumber);
                        resolve(oData);
                    },
                    error: (oXhr) => {
                        const oResponse = oXhr.responseJSON || (typeof oXhr.responseText === "string" ? JSON.parse(oXhr.responseText) : null);
    
                        if (oXhr.status === 403 || (oResponse && oResponse.error && oResponse.error.code === "/IWBEP/CM_V4H_RUN/042")) {
                            this._retryWithFreshToken(sPaddedEquip, sChecklistType).then(resolve).catch(reject);
                        } else {
                            // Parse and show the message on screen
                            this._handleAjaxError(oXhr);
                            reject(oXhr);
                        }
                    }
                });
            });
        },

        /**
         * Fetches a fresh CSRF token and retries the Order Creation
         * @param {string} sPaddedEquip The 18-character equipment number
         * @param {string} sChecklistType The checklist type ID
         */
        _retryWithFreshToken: function(sPaddedEquip, sChecklistType) {
            return new Promise((resolve, reject) => {
                const sUrl = "/sap/bc/http/sap/ZPM_MAINT_ORDER_SRV?sap-client=110";

                console.log("403 detected. Fetching fresh CSRF token...");

                // Perform a GET to fetch a new token
                jQuery.ajax({
                    url: sUrl,
                    type: "GET",
                    xhrFields: { withCredentials: true },
                    headers: { "X-CSRF-Token": "Fetch" },
                    success: (sData, sStatus, oXhr) => {
                        const sFreshToken = oXhr.getResponseHeader("X-CSRF-Token");
                        console.log("Fresh token received. Retrying POST...");

                        // Retry the POST with the new token
                        jQuery.ajax({
                            url: sUrl,
                            type: "POST",
                            contentType: "application/json",
                            xhrFields: { withCredentials: true },
                            headers: { "X-CSRF-Token": sFreshToken },
                            data: JSON.stringify({
                                "Equipment": sPaddedEquip,
                                "CheckListType": sChecklistType
                            }),
                            success: (oResponse) => {
                                let oData = typeof oResponse === "string" ? JSON.parse(oResponse) : oResponse;
                                resolve(oData);
                            },
                            error: (oErr) => reject(oErr)
                        });
                    },
                    error: (oErr) => {
                        this._handleAjaxError(oErr); // Show the "Counter Overflow" message
                        reject(oErr);
                    }
                });
            });
        },

        _createMeasurementDocument: function(sOrderNumber) {
            return new Promise((resolve, reject) => {
                const oInspectionData = this._oInspectionDataModel.getData();
                const oListBinding = this._oMeasurementdocumentDataModel.bindList("/ZC_MeasurementDoc");
                
                let date = new Date();
                date.setTime(date.getTime() - 60000);

                // 1. Create the entry
                const oContext = oListBinding.create({
                    "MeasuringPoint": oInspectionData.latestMeasuringPoint, 
                    "MeasurementReading": parseFloat(oInspectionData.currentReading),
                    "MeasurementReadingInEntryUoM": parseFloat(oInspectionData.currentReading),
                    "MeasurementReadingEntryUoM": oInspectionData.latestMeasuringPointUoM,
                    "MsmtDocumentReferredOrder": sOrderNumber,
                    "MeasurementDocumentText": "Inspection Reading",
                    "MsmtRdngDate": new Date(oInspectionData.date).toISOString().split('T')[0], // Format should be YYYY-MM-DD
                    "MsmtRdngTime": date.toTimeString().split(' ')[0], // HH:MM:SS
                    "MsmtIsDoneAfterTaskCompltn": true,
                    "MsmtRdngStatus": "1",
                    "MsmtRdngByUser": "User"
                });

                // 2. THE SECRET SAUCE: Listen for the error via the model's message manager
                const oMessageManager = sap.ui.getCore().getMessageManager();
                const oMessageModel = oMessageManager.getMessageModel();
                const oMessageBinding = oMessageModel.bindList("/", undefined, undefined, [
                    new sap.ui.model.Filter("processor", sap.ui.model.FilterOperator.EQ, this._oMeasurementdocumentDataModel)
                ]);

                const fnHandler = (oEvent) => {
                    const aMessages = oMessageBinding.getContexts().map(c => c.getObject());
                    const oError = aMessages.find(m => m.type === "Error");

                    if (oError) {
                        oMessageBinding.detachChange(fnHandler);
                        sap.ui.core.BusyIndicator.hide(); // STOP the indicator
                        reject(oError);
                    }
                };

                oMessageBinding.attachChange(fnHandler);

                // 3. Keep the standard promise for SUCCESS
                oContext.created().then(() => {
                    oMessageBinding.detachChange(fnHandler);
                    resolve(oContext.getObject());
                }).catch((err) => {
                    // This usually only catches network/auth errors, not business validation
                    sap.ui.core.BusyIndicator.hide();
                    reject(err);
                });
            });
        },

        _getInspectionLot: function(sEquipment, sOrderNumber) {
            return new Promise((resolve, reject) => {
                const oModel = this._oMainDataModel;
                const sCleanEquip = sEquipment.replace(/^0+/, "");
                
                // 1. Define a Sorter (Descending) to bring the "last" record to the top
                // Replace "InspectionLot" with "CreatedOn" or similar if you want date-based logic
                const oSorter = new sap.ui.model.Sorter("InspectionLot", true); 

                // 2. Create the List Binding with Filter AND Sorter
                const oListBinding = oModel.bindList("/InspectionLot", null, [oSorter], [
                    new sap.ui.model.Filter("Equipment", sap.ui.model.FilterOperator.EQ, sCleanEquip),
                    new sap.ui.model.Filter("ManufacturingOrder", sap.ui.model.FilterOperator.EQ, sOrderNumber)
                ]);

                // 3. Request only the first context (which is now the "last" record due to sorting)
                oListBinding.requestContexts(0, 1).then((aContexts) => {
                    if (aContexts && aContexts.length > 0) {
                        const oData = aContexts[0].getObject();
                        console.log("Latest Inspection Lot found:", oData.InspectionLot);
                        resolve(oData.InspectionLot);
                    } else {
                        reject(new Error("No Inspection Lot found for equipment: " + sCleanEquip) + ", order number: " + sOrderNumber);
                    }
                }).catch((oError) => {
                    console.error("Lot Fetch Error:", oError);
                    reject(oError);
                });
            });
        },

        _navigateToInspectionResults: function (sLotNumber) {
            let oCrossAppNavigator = sap.ushell && sap.ushell.Container && 
                                    sap.ushell.Container.getService("CrossApplicationNavigation");
            
            if (oCrossAppNavigator) {
                // Construct the internal hash: #SemanticObject-Action?Parameters
                let sHash = oCrossAppNavigator.hrefForExternal({
                    target: {
                        semanticObject: "InspectionCharacteristic",
                        action: "recordInspectionResults"
                    },
                    params: {
                        "InspectionLot": sLotNumber
                    }
                });

                // Trigger the navigation
                oCrossAppNavigator.toExternal({
                    target: {
                        shellHash: sHash
                    }
                });
            } else {
                sap.m.MessageToast.show("Fiori Launchpad not found. Navigation aborted.");
                console.log("Target Hash would be: #InspectionCharacteristic-recordInspectionResults?InspectionLot=" + sLotNumber);
            }
        },

        /**
         * Helper to parse and display errors from both OData V2 and V4
         */
        _displayError: function(sMessage, oError) {
            let sDetails = "";

            // Try to extract technical message from OData response
            try {
                if (oError.responseText) { // V2 style
                    const oParsed = JSON.parse(oError.responseText);
                    sDetails = oParsed.error.message.value;
                } else if (oError.message) { // V4 or generic JS error
                    sDetails = oError.message;
                }
            } catch (e) {
                sDetails = "An unexpected technical error occurred.";
            }

            sap.m.MessageBox.error(sMessage, {
                title: "Error",
                details: sDetails
            });
        },

        _handleAjaxError: function(oXhr) {
            let sMessage = "An unexpected error occurred.";
            try {
                const oResponse = oXhr.responseJSON || JSON.parse(oXhr.responseText);
                sMessage = oResponse.error.message;
            } catch (e) {
                sMessage = oXhr.statusText || "Server error";
            }
            
            sap.m.MessageBox.error(sMessage, { title: "Backend Error" });
            sap.ui.core.BusyIndicator.hide(); // Crucial: Stop the spinner!
        },
    });
});