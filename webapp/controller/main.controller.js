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
                var oRoute = oRouter.getRoute("Routemain"); 
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onObjectMatched, this);
                } else {
                    console.error("The route name 'Routemain' was not found in manifest.json");
                }
            }
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

            if (sEquipment && sEquipment.trim() !== "") {
                sap.ui.core.BusyIndicator.show(0);

                this._getEquipment(sEquipment)
                    .then(oRes => {
                        if (oRes && oRes.EquipmentName) {
                            this._oInspectionDataModel.setProperty("/equipmentName", oRes.EquipmentName);
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
                    sLotNum = await this._getInspectionLot(sEquip);
                } catch (e) {
                    // If Lot doesn't exist, we stop here and show an error
                    sap.ui.core.BusyIndicator.hide();
                    sap.m.MessageBox.error("Order created (" + sOrderNum + "), but no Inspection Lot was found for navigation.");
                    return; 
                }

                // Show Toast and Navigate
                sap.ui.core.BusyIndicator.hide();
                sap.m.MessageToast.show("Success! Redirecting to Inspection Results...", {
                    duration: 2000,
                    onClose: function() {
                        this._navigateToInspectionResults(sLotNum);
                    }.bind(this)
                });

            } catch (oErr) {
                sap.ui.core.BusyIndicator.hide();
                this._displayError("Process failed at an early stage", oErr);
            }
        },

        onValidateForm: function() {
            const oData = this.getView().getModel("inspection").getData();
            const oBtnNext = this.byId("btnNext");

            // Ensure these evaluate to actual booleans
            const bIsDateValid = !!oData.date;
            const bIsEquipValid = !!(oData.equipmentNumber && oData.equipmentNumber.trim());
            const bIsTypeValid = !!(oData.checklistType && oData.checklistType !== "");
            const bIsModelValid = !!(oData.modelNumber && oData.modelNumber.trim());
            const bIsReadingValid = typeof oData.currentReading === "number" && oData.currentReading > 0;

            // Combine them into one clean boolean
            const bFormValid = bIsDateValid && bIsEquipValid && bIsTypeValid && bIsModelValid && bIsReadingValid;

            // Use !! to be absolutely sure no string "true" or "" gets through
            oBtnNext.setEnabled(!!bFormValid); 
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
                const sPath = `/EquipmentVH('${sEquipmentNumber}')`;
                
                const oModel = this._oMainDataModel;
                
                // Create a context binding
                const oContextBinding = oModel.bindContext(sPath);

                // Request the data using .requestObject()
                oContextBinding.requestObject().then((oData) => {
                    console.log("Equipment found:", oData);
                    resolve(oData);
                }).catch((oError) => {
                    console.error("Read Error:", oError);
                    // If V4 returns a 404, it triggers the catch block
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
                modelNumber: "",
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

        // _createMaintenanceOrder: function(sEquipmentNumber, sChecklistType) {
        //     return new Promise((resolve, reject) => {
        //         // Only including essential parameters for a standard PM Order
        //         let oHeaderPayload = {
        //             "OrderType": "PM07",
        //             "MaintenanceOrderDesc": "Maint Order - HK1",
        //             "Equipment": sEquipmentNumber,
        //             "MainWorkCenter": "MEC",
        //             "MainWorkCenterInternalID": "10000000",
        //             "MaintenancePlanningPlant": "1000",
        //             "MainWorkCenterPlant": "1000",
        //             "MaintenancePlant": "1000",
        //             "MaintPriority": "1"
        //         };
        //         let oOperationPayload = {
        //             "MaintenanceOrderOperation": "0010",
        //             "MaintenanceOrderSubOperation": "",
        //             "OperationControlKey": "PM01",
        //             "OperationWorkCenterInternalID": "10000000",
        //             // "WorkCenter": "MEC",
        //             "Plant": "1000",
        //             "OperationDescription": "Inspection Task",
        //             // "MaintOperationalChecklistType": sChecklistType,
        //             "OperationPersonResponsible": "59",
        //             "MaintOrdOperationWorkDuration": "1",
        //             "MaintOrdOpWorkDurationUnit": "H",
        //             "MaintOrderOperationQuantity": "1",
        //             "MaintOrdOperationQuantityUnit": "H"
        //         };

        //         // this._oMaintenanceOrderDataModel.create("/MaintenanceOrder", oPayload, {
        //         //     success: function(oData) {
        //         //         console.log("Order created successfully:", oData.MaintenanceOrder);
        //         //         resolve(oData);
        //         //     },
        //         //     error: function(oError) {
        //         //         console.error("Creation failed:", oError);
        //         //         reject(oError);
        //         //     }
        //         // });


        //         // 3. Create the List Binding for the Header
        //         const oHeaderBinding = this._oMaintenanceOrderDataModel.bindList("/MaintenanceOrder");
                
        //         // 4. Create the Header Context
        //         const oHeaderContext = oHeaderBinding.create(oHeaderPayload);

        //         // 5. Create the Operation Binding *relative* to the Header Context
        //         // This ensures the dependency: No Header = No Operation
        //         const oOpBinding = this._oMaintenanceOrderDataModel.bindList("_MaintenanceOrderOperation", oHeaderContext);
        //         oOpBinding.create(oOperationPayload);

        //         // 6. Monitor the Header's creation status
        //         oHeaderContext.created().then(() => {
        //             // Success: Both Header and Operation are created
        //             const oCreatedData = oHeaderContext.getObject();
        //             resolve(oCreatedData);
        //         }).catch((oError) => {
        //             // Failure: Server rejected the Header (and thus the Operation)
        //             if (oHeaderContext.isTransient()) {
        //                 oHeaderContext.delete(); 
        //             }
        //             reject(oError);
        //         });
        //     });
        // },

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
                        resolve(oData);
                    },
                    error: (oXhr) => {
                        // If it returns 403, we need to do the 'Fetch' dance again 
                        // but specifically through this AJAX call.
                        if (oXhr.status === 403 || oXhr.getResponseHeader("x-csrf-token") === "Required") {
                            this._retryWithFreshToken(sEquipmentNumber, sChecklistType).then(resolve).catch(reject);
                        } else {
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
                        console.error("Could not refresh CSRF token.");
                        reject(oErr);
                    }
                });
            });
        },

        _createMeasurementDocument: function(sOrderNumber) {
            return new Promise((resolve, reject) => {
                let oInspectionData = this._oInspectionDataModel.getData();
                
                const oListBinding = this._oMeasurementdocumentDataModel.bindList("/ZC_MeasurementDoc");


                const oPayload = {
                    "MeasuringPoint": "1", 
                    "MeasurementReading": parseFloat(oInspectionData.currentReading),
                    "MeasurementReadingInEntryUoM": parseFloat(oInspectionData.currentReading),
                    "MeasurementReadingEntryUoM": "MI",
                    "MsmtDocumentReferredOrder": sOrderNumber,
                    "MeasurementDocumentText": "Inspection Reading",
                    "MsmtRdngDate": oInspectionData.date, // Format should be YYYY-MM-DD
                    "MsmtRdngTime": new Date().toLocaleTimeString('en-GB', { hour12: false }), // HH:MM:SS
                    "MsmtIsDoneAfterTaskCompltn": true,
                    "MsmtRdngStatus": "1",
                    "MsmtRdngByUser": "User"
                };

                // Create the entry
                const oContext = oListBinding.create(oPayload);

                oContext.created().then(() => {
                    const oCreatedData = oContext.getObject();
                    console.log("Measurement Doc Created:", oCreatedData.MeasurementDocument);
                    resolve(oCreatedData);
                }).catch((oError) => {
                    if (oContext.isTransient()) {
                        oContext.delete(); 
                    }
                    reject(oError);
                });
            });
        },

        _getInspectionLot: function(sEquipment) {
            return new Promise((resolve, reject) => {
                const oModel = this._oMainDataModel; // Reference to your OData V4 model
                const sCleanEquip = sEquipment.replace(/^0+/, "");
                
                // 1. Create the List Binding for the "InspectionLot" entity set
                const oListBinding = oModel.bindList("/InspectionLot", null, null, [
                    new sap.ui.model.Filter("Equipment", sap.ui.model.FilterOperator.EQ, sCleanEquip)
                ]);

                // Request the contexts from the server
                // requestContexts(start index, length) returns a Promise
                oListBinding.requestContexts(0, 1).then((aContexts) => {
                    if (aContexts && aContexts.length > 0) {
                        // 3. Extract the data object from the first context found
                        const oData = aContexts[0].getObject();
                        console.log("Inspection Lot found:", oData.InspectionLot);
                        resolve(oData.InspectionLot);
                    } else {
                        // Handle case where no lot is found for the equipment
                        reject(new Error("No Inspection Lot found for equipment: " + sCleanEquip));
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
        
        onValueHelpRequest: function (oEvent) {
            var sValue = this.getView().byId("equipmentNumber").getValue();

            // Create the SelectDialog
            if (!this._oValueHelpDialog) {
                this._oValueHelpDialog = new sap.m.SelectDialog({
                    title: "Select Equipment",
                    items: {
                        path: "/EquipmentVH", // EntitySet from your metadata
                        template: new sap.m.StandardListItem({
                            title: "{Equipment}",
                            description: "{EquipmentName}",
                            type: "Active"
                        })
                    },
                    search: function (oEvent) {
                        var sSearchValue = oEvent.getParameter("value");
                        var oFilter = new sap.ui.model.Filter({
                            filters: [
                                new sap.ui.model.Filter("Equipment", sap.ui.model.FilterOperator.Contains, sSearchValue),
                                new sap.ui.model.Filter("EquipmentName", sap.ui.model.FilterOperator.Contains, sSearchValue)
                            ],
                            and: false // This makes it an OR search
                        });
                        oEvent.getSource().getBinding("items").filter([oFilter]);
                    },
                    confirm: function (oEvent) {
                        var oSelectedItem = oEvent.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sId = oSelectedItem.getTitle();
                            var sName = oSelectedItem.getDescription();
                            
                            // Set values to your model
                            this._oInspectionDataModel.setProperty("/equipmentNumber", sId);
                            this._oInspectionDataModel.setProperty("/equipmentName", sName);
                            
                            this.onValidateForm();
                        }
                    }.bind(this)
                });
                this.getView().addDependent(this._oValueHelpDialog);
            }

            // Open the dialog with the current input value as the initial filter
            this._oValueHelpDialog.open(sValue);
        },
    });
});